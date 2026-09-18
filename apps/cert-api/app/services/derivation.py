"""Derivações de status (port do projeto Verificao_status — sessão 2026-05-22).

Recebe um row de `cert_products` e devolve 4 dimensões semânticas adicionais
que o time fiscal (Carla / Eduarda) pediu na reunião:

    cert_status            ATIVO | ENCERRADO
    site_status            CONFORME | NAO_CONFORME (+ site_status_reason)
    license_status         VALIDO | VENCIDO | NAO_APLICAVEL
    comercializacao_status LIBERADA | DENTRO_PRAZO | ENCERRADA | NAO_APLICA

Feedback Eduarda 2026-06-19:
- cert_status colapsa para apenas ATIVO / ENCERRADO (sem EM_ANDAMENTO,
  SKU_EXCLUIDO, DESCONHECIDO). "Ativo" = certificação ativa OU dentro do prazo
  de venda. "Encerrado" = encerrada, SKU excluído OU fora do prazo de venda.
- site_status colapsa para apenas CONFORME / NAO_CONFORME (sem PENDENTE). Quando
  NAO_CONFORME por erro/indefinição, acompanha frase obrigatória em
  `site_status_reason` (a UI exige a frase explicativa).
- license_status deixa de replicar dados de certificação: vem da aba
  "Licenciamentos Vencidos" via `license_map` (process_code/SKU → status+prazo),
  com fallback NAO_APLICAVEL quando não há linha correspondente.

Feedback 2026-07-16 (Eduarda, via PI4511Y "CANETA MUDA FRASES HP FEITICOS"):
- Certificação encerrada NÃO implica produto irregular no site. Enquanto o prazo
  de comercialização estiver vigente (ex.: cert encerrada, prazo 02/03/2028), o
  produto pode continuar sendo vendido → comercializacao_status DENTRO_PRAZO e o
  site_status julgado pelos mesmos critérios de um produto ATIVO (o prazo vigente
  absolve a certificação encerrada, mas não absolve frase errada na página nem
  validação que não rodou). Vira ENCERRADA quando o prazo passa, não existe, ou o
  SKU foi excluído.
- O prazo passa a ser avaliado por DATA (`sale_deadline_date`), não só pelo texto
  da janela de venda ("fim do lote"); antes, um prazo com data futura não era
  reconhecido e o item caía em NAO_CONFORME indevidamente.

Feedback 2026-08-07 (Eduarda, casos 100400496 / PI7560Y):
- A coluna 'STATUS' da aba "Encerramentos" ("Comerciação Permitida" / "Vencido -
  Venda Bloqueada" / "Venda até fim do lote") é a palavra final sobre poder
  vender ou não. (Era a coluna H até 09/2026, quando a planilha inseriu uma
  coluna de lembrete antes dela — por isso toda a leitura é por CABEÇALHO, e
  estes textos citam cabeçalho, não letra.) Ela existe para 28 SKUs que NÃO têm
  data em 'PRAZO FINAL VENDA', e a leitura antiga, que exigia data, simplesmente
  descartava essas linhas — deixando o produto sem
  prazo nenhum e caindo em ENCERRADO/NAO_CONFORME (caso PI7560Y).
- "Item excluído e incluído novamente" é REINCLUSÃO, não exclusão. O teste de
  substring `"exclu" in texto` sobre o histórico inteiro tratava a frase como
  exclusão e derrubava o item para ENCERRADO com prazo vigente. Ver
  `_is_sku_excluded`.

Reunião 2026-09-11 (decisão D11), que SEPARA os dois eixos que estavam colapsados:
- O STATUS do certificado passa a sair da coluna U (SITUAÇÃO) das abas de produto:
  "Ativo" → ATIVO; "Encerrado" / "SKU excluído" → ENCERRADO; SKU que só existe na
  aba "Encerramentos" → ENCERRADO. O texto livre do histórico continua valendo
  apenas como FALLBACK, para a linha que não tem U preenchida.
- A TRAVA de venda é outra dimensão: a MENOR data real entre o fim de venda da
  certificação (aba "Encerramentos", só quando o certificado está encerrado) e o
  fim do licenciamento (propriedade 00107/00225 do Linx). Certificado ATIVO nunca
  tem trava de certificação ("enquanto ele estiver ativo eu posso vender").
  Data nula ou com ano < 2000 (a sentinela 01/01/1900 do Linx) é AUSENTE, nunca
  "a menor data". Ver `derive_trava_venda` e `derive_status_venda`.

Revisão 2026-09-18 (medição no Linx + regras R4/R8 da mesma reunião):
- license_status ganha a leitura da APLICABILIDADE a partir de `grife` e
  `linx_synced_at` (ver `derive_licenciamento`): Linx não lido → PENDENTE;
  grife vazia/da casa → NAO_APLICAVEL; licenciador sem data → PENDENTE.
- Licenciamento PENDENTE nunca bloqueia a venda sozinho: ~95% dos SKUs
  certificados não são licenciados e apareciam BLOQUEADOS por falta de uma data
  que nunca vai existir.
- Encerramento do MESMO certificado identificado por
  `encerramento_numero_certificado` rege a venda mesmo com SITUAÇÃO ainda ativa.
  A situação da fonte é preservada; outro certificado ou identificação ausente
  mantém a regra D11 para ativos, sem herdar prazo de certificado antigo.

Sem efeitos colaterais; sem dependências externas; campos computados em runtime
(não persiste no DB). Pode ser usado direto em routes ou em report_service.
"""

from __future__ import annotations

import re
import unicodedata
from datetime import date, datetime
from zoneinfo import ZoneInfo

# Palavras-chave que indicam "produto regulado por órgão de certificação".
# Vem do scraper.py + cert_service.py (que já detecta inmetro/anatel/abnt/anvisa).
REGULATED_KEYWORDS = (
    "INMETRO", "ANATEL", "MAPA", "ANVISA", "ABNT", "OCP", "BRICS",
)


# ---------- Constantes / valores válidos ----------

CERT_STATUS_VALUES = {"ATIVO", "ENCERRADO", "PENDENTE"}
SITE_STATUS_VALUES = {"CONFORME", "NAO_CONFORME"}
LICENSE_STATUS_VALUES = {"VALIDO", "VENCIDO", "NAO_APLICAVEL", "PENDENTE"}
COMERCIALIZACAO_STATUS_VALUES = {"LIBERADA", "DENTRO_PRAZO", "ENCERRADA", "NAO_APLICA", "PENDENTE"}

# D11: os dois valores gravados em cert_products.status_venda (o CHECK do banco
# aceita exatamente estes) e as duas origens possíveis da trava.
STATUS_VENDA_VALUES = {"LIBERADA", "BLOQUEADA"}
TRAVA_ORIGEM_VALUES = {"certificacao", "licenciamento"}

# Formatos de data aceitos em TODA data de trava (planilha em pt-BR, Postgres em
# ISO). Um único lugar: ver `parse_data_real`.
_DATE_FORMATS = ("%d/%m/%Y", "%Y-%m-%d", "%d-%m-%Y", "%d/%m/%y")

# O Linx representa "campo criado, data não preenchida" com 01/01/1900, e essa
# sentinela é a MAIORIA das linhas das propriedades de certificado. Tratá-la como
# data real faria dela sempre "a menor data" — travando a venda de todo mundo em
# 1900. Nenhum certificado vivo tem data anterior a 2000.
DATA_ANO_MINIMO = 2000

# Marcas da CASA, já normalizadas por `_norm_marca` (sem acento, sem caixa). No
# Linx a coluna de grife (PRODUTOS.GRIFFE na Puket, IMG_LICENCIAMENTO na
# Imaginarium) guarda o LICENCIADOR só quando o produto é licenciado (MINIONS,
# SNOOPY, LILO & STITCH, HARRY POTTER); no resto vem a própria marca ou vazio.
# Medição de 18/09/2026 nos SKUs certificados: Puket com grife "PUKET" em 381 de
# 397; Imaginarium com grife vazia em 276 de 277 — ~95% do catálogo NÃO é
# licenciado, e grife da casa/vazia significa "licenciamento não se aplica".
MARCAS_DA_CASA = frozenset({"puket", "imaginarium", "ludi", "mind"})

LICENSE_REASON_LINX_NAO_LIDO = "Licenciamento ainda nao foi lido do Linx"

# Coluna 'STATUS' da aba "Encerramentos", normalizada. PERMITIDA e FIM_LOTE liberam a
# venda; BLOQUEADA a proíbe. None = SKU sem linha de encerramento.
VENDA_ENCERRAMENTO_VALUES = {"PERMITIDA", "BLOQUEADA", "FIM_LOTE"}

# Frase obrigatória exibida na UI quando o site_status fica NAO_CONFORME por
# indefinição/erro de validação (não pode haver terceiro estado silencioso).
# Eduarda 2026-06-19 baniu a palavra "Pendente" como status; este é apenas a
# FRASE explicativa de um item NAO_CONFORME — usamos "a confirmar" para não dar
# impressão de um terceiro status remanescente.
SITE_REASON_PENDING = "Verificacao a confirmar - revisar"


# Fuso de referência do negócio. O container do cert-api roda em UTC, então
# `date.today()` vira o dia SEGUINTE às 21:00 de Brasília: um prazo de venda que
# vence "hoje" era avaliado como vencido três horas antes, virando ENCERRADO na
# tela ainda dentro do dia útil. Todo cálculo de "hoje" nas derivações passa por
# `_today_sp()`, e todas as funções aceitam `today` explícito para teste.
BUSINESS_TIMEZONE = ZoneInfo("America/Sao_Paulo")


# ---------- Helpers ----------

def _today_sp() -> date:
    """Data de hoje no fuso America/Sao_Paulo (não no fuso do processo)."""
    return datetime.now(BUSINESS_TIMEZONE).date()


def parse_data_real(value: object) -> date | None:
    """Parser ÚNICO de data de trava: devolve `date` só quando a data é REAL.

    "Real" exclui três coisas que o operador enxerga como "sem data":
    vazio/None, texto que não é data ("Venda até fim do lote", "a definir") e a
    sentinela do Linx — qualquer ano anterior a `DATA_ANO_MINIMO`, que cobre o
    01/01/1900 e as variações digitadas à mão (1900, 1901, 1999...).

    Era esta normalização que estava duplicada e DIVERGENTE: `report_service`
    cortava em ano < 2000 e `linx_service` em ano <= 1900, então 01/01/1950
    contava como trava num lugar e não contava no outro. Os dois passam por aqui.

    Args:
        value: `date`, `datetime`, string ISO/pt-BR, ou qualquer texto.

    Returns:
        `date` quando há data real; None para ausente/sentinela/texto livre.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        parsed = value.date()
    elif isinstance(value, date):
        parsed = value
    else:
        parsed = None
        texto = str(value).strip()
        if not texto:
            return None
        for fmt in _DATE_FORMATS:
            try:
                parsed = datetime.strptime(texto, fmt).date()
                break
            except ValueError:
                continue
        if parsed is None:
            return None
    return None if parsed.year < DATA_ANO_MINIMO else parsed


def _is_regulated(cert_type: str | None) -> bool:
    """True se o tipo de certificação menciona órgão regulado conhecido."""
    if not cert_type:
        return False
    up = str(cert_type).upper()
    return any(k in up for k in REGULATED_KEYWORDS)


def _norm(s: str | None) -> str:
    if not s:
        return ""
    return str(s).strip().lower()


def _norm_marca(value: object) -> str:
    """Normaliza grife/marca para comparação: sem acento, sem caixa, espaço único."""
    if value is None:
        return ""
    texto = unicodedata.normalize("NFKD", str(value))
    texto = "".join(ch for ch in texto if not unicodedata.combining(ch))
    return " ".join(texto.lower().split())


# Negação em português. Aplicada DENTRO da cláusula, nunca numa janela de N
# caracteres: o histórico da planilha é uma lista de "dd/mm - frase.", e uma
# janela cega faria a negação de uma entrada contaminar a entrada seguinte
# ("...não será continuada / 23/10/25 - Manutenção finalizada" é afirmativa).
_NEGACAO_RE = re.compile(r"\b(n[aã]o|nunca|jamais|sem|nenhum[ao]?|deixou de)\b")
_SEPARADOR_CLAUSULA = re.compile(r"[\n;|]+|(?<=\.)\s+")

# Vocabulário que PROÍBE a venda. Verificado antes de qualquer marcador
# positivo: nenhuma dessas palavras pode ser anulada por um "permitida" na
# mesma frase.
BLOQUEIO_VENDA = (
    "bloquead", "proibid", "suspens", "vetad", "cancelad", "revogad",
    "negad", "indeferid", "reprovad", "apreend", "recall", "impedid",
)


def _clausulas(texto: str | None):
    """Quebra o texto em cláusulas independentes, já normalizadas."""
    for parte in _SEPARADOR_CLAUSULA.split(_norm(texto)):
        parte = parte.strip()
        if parte:
            yield parte


def _afirmativo(texto: str | None, *marcadores: str) -> bool:
    """True quando algum marcador aparece em cláusula SEM negação antes dele.

    É o que separa "Registro concedido" de "Registro NÃO concedido" e
    "Comerciação Permitida" de "Venda NÃO permitida". O teste antigo era
    `marcador in texto`, que dava o mesmo veredito para os dois — e sempre o
    veredito permissivo, que é a direção errada do erro.
    """
    for clausula in _clausulas(texto):
        for marcador in marcadores:
            i = clausula.find(marcador)
            if i >= 0 and not _NEGACAO_RE.search(clausula[:i]):
                return True
    return False


def _tem_bloqueio(texto: str | None) -> bool:
    """True quando o texto traz qualquer palavra que proíbe a venda."""
    s = _norm(texto)
    return any(t in s for t in BLOQUEIO_VENDA)


def _is_sku_excluded(sheet_status: str | None) -> bool:
    """True quando o histórico diz que o SKU foi excluído e NÃO reincluído.

    O `sheet_status` é o log multilinha da planilha, entrada mais recente PRIMEIRO.
    O teste antigo (`"exclu" in texto_inteiro`) tratava qualquer menção como
    exclusão terminal — inclusive "27/10/25 - Item excluído e incluído novamente
    com o novo nome", que é exatamente o oposto (caso PI7560Y, Eduarda 2026-08-07:
    item exibido como Encerrado/Nao conforme com prazo de venda vigente).

    Regra: percorre da entrada mais recente para a mais antiga e para na PRIMEIRA
    que fala de exclusão. Se essa mesma entrada também fala de inclusão, o item
    voltou ao catálogo e não está excluído.
    """
    for line in str(sheet_status or "").splitlines():
        frag = _norm(line)
        if "exclu" not in frag:
            continue
        # Remove as próprias ocorrências de "exclu*" antes de procurar "inclu*",
        # senão "excluído" casaria consigo mesmo ("ex-CLUÍDO" não, mas "exclu" e
        # "inclu" compartilham o sufixo em variações como "exclusão/inclusão").
        return "inclu" not in frag.replace("exclu", " ")
    return False


def derive_venda_encerramento(encerramento_status: str | None) -> str | None:
    """Normaliza a coluna 'STATUS' da aba "Encerramentos" em PERMITIDA/BLOQUEADA/FIM_LOTE.

    Valores reais da planilha (conferidos em 2026-08-07, 389 linhas):
        'Comerciação Permitida'              -> PERMITIDA  (203)
        'Vencido - Venda Bloqueada'          -> BLOQUEADA  (178)
        'Vencido - Venda Bloqueada (Recall)' -> BLOQUEADA  (1)
        'Venda até fim do lote'              -> FIM_LOTE   (7)

    Returns:
        'PERMITIDA' | 'BLOQUEADA' | 'FIM_LOTE', ou None quando não há linha de
        encerramento (ou o texto não é reconhecido — nunca inventa permissão).
    """
    s = _norm(encerramento_status)
    if not s:
        return None
    # Proibição primeiro: nenhuma palavra permissiva na mesma frase pode anular
    # um "bloqueada"/"suspensa"/"cancelada".
    if _tem_bloqueio(s):
        return "BLOQUEADA"
    if _afirmativo(s, "fim do lote", "fim de lote"):
        return "FIM_LOTE"
    # `_afirmativo` (e não `in`) para que "Venda NÃO permitida" deixe de liberar
    # a venda. Sem marcador afirmativo devolve None: a ausência de veredito não
    # concede permissão, ela apenas devolve a decisão ao prazo.
    if _afirmativo(s, "permitid", "liberad", "autorizad"):
        return "PERMITIDA"
    return None


# ---------- Derivações ----------

def _within_sale_window(sale_deadline_raw: str | None) -> bool:
    """True quando o prazo de venda ('fim do lote'/'fim de venda') ainda cobre o item.

    Mantém a lógica de prazo de venda que reativa um item expirado enquanto ele
    estiver dentro da janela de venda (venda até o fim do lote / fim de venda).
    """
    deadline = _norm(sale_deadline_raw)
    return (
        "fim do lote" in deadline
        or "fim de lote" in deadline
        or "fim de venda" in deadline
        or "fim da venda" in deadline
        or "ate o fim" in deadline
    )


def _parse_deadline_date(value: object) -> date | None:
    """Converte um prazo de venda em `date`, aceitando date/datetime/texto.

    O DB entrega `sale_deadline_date` como `date`, mas o agregado do dashboard
    projeta só o texto (`sale_deadline`, ex.: "02/03/2028"); aceitar ambos evita
    que a contagem divirja da tabela. Texto não-data ("Vencido") → None.
    """
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%d/%m/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def derive_within_sale_deadline(
    sheet_status: str | None,
    sale_deadline_raw: str | None,
    sale_deadline_date: object = None,
    today: date | None = None,
    encerramento_status: str | None = None,
) -> bool:
    """True quando o produto ainda pode ser comercializado (prazo de venda vigente).

    Ordem de decisão:
    1. SKU excluído (e não reincluído) NUNCA está dentro do prazo — a regra da
       Eduarda (2026-06-19) põe a exclusão acima da janela de venda.
    2. A coluna 'STATUS' da aba "Encerramentos" (`encerramento_status`) manda
       quando existe: é onde o time fiscal declara "Comerciação Permitida" ou
       "Vencido - Venda Bloqueada". 28 SKUs têm esse veredito SEM data em
       'PRAZO FINAL VENDA', então
       exigir data descartaria a única informação disponível (caso PI7560Y).
    3. Janela textual ("venda até o fim do lote") — sem data de corte.
    4. Data futura ou de hoje em `sale_deadline_date` (inclusiva: no último dia
       ainda se pode vender).

    "Vencido" escrito no prazo também manda, como já manda em `derive_cert_status`:
    um item que passou a "Vencido" na planilha pode conservar a data antiga e não
    pode ser lido como vigente por causa dela.
    """
    if _is_sku_excluded(sheet_status):
        return False
    venda = derive_venda_encerramento(encerramento_status)
    if venda == "BLOQUEADA":
        return False
    deadline = parse_data_real(sale_deadline_date) or parse_data_real(sale_deadline_raw)
    if deadline is not None and deadline < (today or _today_sp()):
        return False
    if venda in ("PERMITIDA", "FIM_LOTE"):
        return True
    if "vencido" in _norm(sale_deadline_raw):
        return False
    if _within_sale_window(sale_deadline_raw):
        return True
    deadline = _parse_deadline_date(sale_deadline_date) or _parse_deadline_date(sale_deadline_raw)
    if deadline is None:
        return False
    return deadline >= (today or _today_sp())


_SITUACAO_ATIVA_RE = re.compile(r"^(ativ[oa]|vigente)\b")


def derive_situacao_status(situacao: str | None) -> str | None:
    """Traduz a coluna U (SITUAÇÃO) das abas de produto em ATIVO | ENCERRADO.

    Valores reais da planilha (11/09/2026): 'Ativo', 'Encerrado', 'SKU excluído'.
    A reunião definiu que é ESTA coluna que diz se o certificado está vivo — não o
    prazo de venda, que é a trava e vive noutro eixo (Pelúcia Mozi e Bicho
    Machine apareciam ATIVOS por terem prazo de venda futuro, com o certificado
    encerrado desde 2024/2025).

    Returns:
        'ATIVO' | 'ENCERRADO', ou None quando a célula está vazia ou traz texto
        que não dá para classificar — aí quem decide é o fallback histórico, e
        não um palpite desta função.
    """
    s = _norm(situacao)
    if not s:
        return None
    if "exclu" in s or "encerrad" in s or _tem_bloqueio(s):
        return "ENCERRADO"
    # A célula é digitada à mão: "Ativo.", " ativo ", "ATIVA", "Ativo;" são o mesmo
    # valor. A palavra tem de ABRIR a célula e terminar em fronteira — "Inativo",
    # "Não ativo", "Reativo" e "Ativou o cadastro" continuam sem classificação.
    if _SITUACAO_ATIVA_RE.match(s):
        return "ATIVO"
    return None


def derive_cert_status(
    sheet_status: str | None,
    is_expired: bool | None,
    sale_deadline_raw: str | None,
    encerramento_status: str | None = None,
    sale_deadline_date: object = None,
    today: date | None = None,
    situacao: str | None = None,
    somente_encerramentos: bool = False,
) -> str:
    """Situacao do certificado, independente de qualquer prazo comercial.

    Situacao declarada precede o historico. Na ausencia dela, somente sinais
    afirmativos do historico podem indicar atividade. Validade vencida e
    situacao ativa sao expostas como inconsistencia pelo orquestrador.
    Parametros de prazo sao preservados por compatibilidade, sem decidir status.
    """
    # Coluna U: a fonte declarada pelo time fiscal. Precede tudo.
    por_situacao = derive_situacao_status(situacao)
    if por_situacao is not None:
        return por_situacao
    if somente_encerramentos:
        return "ENCERRADO"

    s = _norm(sheet_status)
    if _is_sku_excluded(sheet_status):
        return "ENCERRADO"

    # O sheet_status frequentemente carrega o HISTÓRICO inteiro da planilha
    # (log multilinha, entrada mais recente PRIMEIRO). Fazer substring no texto
    # todo deixava uma entrada velha ("25/11/24 - Registro encerrado.") vencer a
    # mais recente ("13/03/2026 - Manutenção Finalizada") — e "Registro
    # concedido" nem era reconhecido (caso Eduarda 2026-07-17: PI7550Y/51Y/53Y,
    # 26 produtos ATIVOS exibidos como Encerrado). A ENTRADA MAIS RECENTE decide;
    # o texto completo fica como fallback para os formatos antigos de uma linha.
    latest = _norm(str(sheet_status or "").splitlines()[0] if sheet_status else "")

    def _classify(fragment: str) -> str | None:
        """Classifica um fragmento de status; None quando não há marcador claro."""
        if not fragment:
            return None
        # Em andamento → conservador ENCERRADO (sem flag clara de atividade).
        if "andamento" in fragment:
            return "ENCERRADO"
        if fragment == "expired" or "vencid" in fragment or "encerrad" in fragment:
            return "ENCERRADO"
        # Vocabulário que invalida o certificado agora (suspenso, cancelado,
        # revogado, indeferido...). Precede os marcadores positivos.
        if _tem_bloqueio(fragment):
            return "ENCERRADO"
        # "conce": cobre "Registro concedido", "Inclusão concedida" e o typo real
        # da planilha "concecida". Concessão de registro = certificação ativa.
        # `_afirmativo` em vez de `in`: "Registro NÃO concedido" e "Manutenção
        # não finalizada" deixam de valer como sinal de atividade.
        if fragment == "ativo" or fragment == "expiring" or _afirmativo(
            fragment, "finalizad", "conce"
        ):
            if is_expired:
                return "ENCERRADO"
            return "ATIVO"
        return None

    verdict = _classify(latest)
    if verdict is None and latest != s:
        verdict = _classify(s)
    if verdict is not None:
        return verdict

    # sheet_status vazio ou texto livre sem marcador → deduz pelos sinais
    # binários, de forma conservadora (default ENCERRADO quando não claramente
    # ativo).
    return _fallback_from_expiration(is_expired, sale_deadline_raw, sale_deadline_date, today)


def _fallback_from_expiration(
    is_expired: bool | None,
    sale_deadline_raw: str | None,
    sale_deadline_date: object = None,
    today: date | None = None,
) -> str:
    """Sem situacao reconhecida nao se infere atividade a partir da venda."""
    # Prazo comercial nunca e evidencia de certificacao ativa.
    return "ENCERRADO"


def derive_site_status(
    last_validation_status: str | None,
    cert_status: str,
    expected_cert_text: str | None,
    certification_type: str | None,
    within_sale_deadline: bool = False,
    licenciamento_vencido: bool = False,
    venda_bloqueada_encerramento: bool = False,
) -> tuple[str, str | None]:
    """Status de conformidade no e-commerce — colapsado em CONFORME | NAO_CONFORME.

    Feedback Eduarda 2026-06-19 (sem PENDENTE — nunca um terceiro estado silencioso):
    - "Conforme": NÃO está no site, OU está no site com certificação ATIVO /
      dentro da validade.
    - "Nao conforme": está no site mas o prazo de certificação/licenciamento
      acabou, foi excluído, OU há um erro que precisa de revisão. Quando é
      NAO_CONFORME por erro/indefinição, retorna também a frase obrigatória
      (`reason`) que a UI exibe — o frontend lê `site_status_reason` pelo index
      signature do CertProduct.

    Feedback 2026-07-16: certificação encerrada com prazo de comercialização
    vigente (`within_sale_deadline`) continua CONFORME no site — a venda ainda é
    permitida até o prazo. Ver `derive_within_sale_deadline`.

    Args:
        within_sale_deadline: produto ainda dentro do prazo de comercialização.
            Default False mantém a leitura conservadora de quem chama sem o prazo.
        licenciamento_vencido: o fim do licenciamento (Linx) já passou. É a outra
            metade do "prazo de certificação/licenciamento acabou" acima: produto
            no site com a licença vencida é NAO_CONFORME mesmo com o certificado
            ATIVO ou com a venda da certificação ainda permitida. Só data REAL
            vencida entra aqui — licenciamento PENDENTE/NAO_APLICAVEL não derruba
            o site (regras R4/R8). Default False = chamador que não conhece o eixo.
        venda_bloqueada_encerramento: bloqueio explícito da aba Encerramentos,
            inclusive quando a situação da aba da marca ainda está ativa.
            Fora do site continua não havendo irregularidade de publicação.

    Returns:
        Tupla (status, reason). `reason` é None quando CONFORME ou quando o
        NAO_CONFORME é autoexplicativo pela própria certificação.
    """
    vs = last_validation_status

    # Nunca validado / status ausente → nunca silencia: marca NAO_CONFORME e
    # sinaliza a frase obrigatória de revisão.
    if vs is None or vs == "":
        return "NAO_CONFORME", SITE_REASON_PENDING

    # Cadastro incompleto (frase esperada vazia) em produto regulado + cert ativa
    if (
        vs == "NO_EXPECTED"
        and not expected_cert_text
        and cert_status == "ATIVO"
        and _is_regulated(certification_type)
    ):
        return "NAO_CONFORME", "Frase de certificacao obrigatoria ausente no cadastro"

    # Sem frase esperada para comparar → não dá para confirmar: flag para revisão.
    if vs == "NO_EXPECTED":
        return "NAO_CONFORME", SITE_REASON_PENDING

    found_on_site = vs != "URL_NOT_FOUND"

    # Cert encerrada / SKU excluído FORA do prazo: se está no site, é não-conforme.
    if cert_status == "ENCERRADO" and not within_sale_deadline:
        if found_on_site:
            return "NAO_CONFORME", "Certificacao encerrada / fora do prazo com produto no site"
        return "CONFORME", None

    # Licenciamento vencido com o produto no site: a venda está BLOQUEADA pela
    # trava de licenciamento, então a página no ar é irregular, qualquer que seja
    # o estado do certificado. Fora do site não há o que corrigir.
    if licenciamento_vencido and found_on_site:
        return "NAO_CONFORME", "Licenciamento vencido com produto no site"

    if venda_bloqueada_encerramento and found_on_site:
        return "NAO_CONFORME", "Venda bloqueada em Encerramentos com produto no site"

    # ATIVO, ou ENCERRADO ainda dentro do prazo de comercialização (Eduarda
    # 2026-07-16, caso PI4511Y): a venda é permitida, então o site é julgado pelos
    # MESMOS critérios de conteúdo dos dois casos. O prazo vigente absolve a
    # certificação encerrada — não absolve frase errada na página nem validação que
    # sequer rodou.
    if cert_status in ("ATIVO", "ENCERRADO"):
        if vs in ("URL_NOT_FOUND", "OK"):
            # Fora do site (OK) ou cadastro consistente → conforme.
            return "CONFORME", None
        if vs == "EXPIRED":
            # O validador só marca EXPIRED com o prazo de venda já vencido; se o
            # prazo consta vigente, os dois sinais se contradizem → revisar.
            return "NAO_CONFORME", "Certificacao vencida no site"
        # MISSING / INCONSISTENT / API_ERROR / outros → revisar.
        return "NAO_CONFORME", SITE_REASON_PENDING

    # cert_status fora do esperado (defensivo) → nunca silencia.
    return "NAO_CONFORME", SITE_REASON_PENDING


def derive_license_status(
    license_row: dict | None,
) -> tuple[str, str | None]:
    """Status de licenciamento — vem EXCLUSIVAMENTE da aba 'Licenciamentos Vencidos'.

    Feedback Eduarda 2026-06-19: licenciamento deixa de replicar dados de
    certificação. O status e o prazo ('Licen. - Prazo') vêm de uma linha da aba
    de licenciamentos vencidos casada por SKU/identificador de processo
    (ex.: PI4257Y). Sem linha correspondente → NAO_APLICAVEL.

    Args:
        license_row: dict de `erp_service.read_licenciamentos_vencidos()` para a
            chave (process_code/SKU) do produto, ou None quando não há match.
            Esperado: {"status": "VALIDO"|"VENCIDO", "valid_until": <ISO|None>}.

    Returns:
        Tupla (license_status, license_deadline). `license_deadline` alimenta o
        campo 'Licen. - Prazo'. Ambos defaultam para (NAO_APLICAVEL, None).
    """
    if not license_row:
        return "NAO_APLICAVEL", None
    status = str(license_row.get("status") or "").strip().upper()
    deadline = license_row.get("valid_until")
    if isinstance(deadline, str):
        deadline = deadline.strip() or None
    if status in ("VENCIDO", "VENCIDA", "EXPIRED"):
        return "VENCIDO", deadline
    if status in ("VALIDO", "VÁLIDO", "VALIDA", "VALID", "ATIVO"):
        return "VALIDO", deadline
    # Linha existe mas status não reconhecido → não aplicável (não inventa dado).
    return "NAO_APLICAVEL", deadline


def derive_trava_venda(
    fim_venda_certificacao: object,
    fim_licenciamento: object,
    cert_status: str | None = None,
) -> tuple[date | None, str | None]:
    """Trava de venda = a MENOR data REAL entre certificação e licenciamento.

    Regra da reunião [35:34]-[37:40]: "sempre a menor data entre certificação e
    licenciamento, independente de qual seja". E [39:17]: "os produtos que estão
    ATIVOS a gente não pode ter data na coluna de certificação" — por isso o
    componente de certificação é ZERADO quando `cert_status == 'ATIVO'`, mesmo
    que a planilha ou o Linx tragam uma data ali (é a validade do certificado,
    que serve para decidir manutenção/encerramento, e não trava venda nenhuma).

    Nulo e sentinela (ano < 2000) são AUSENTES, nunca "a menor data" — é o
    defeito que a reunião descreveu em [40:11] ("em alguns casos traz uma data
    tipo 1900").

    Args:
        fim_venda_certificacao: fim de venda da certificação encerrada (coluna
            'PRAZO FINAL VENDA' da aba "Encerramentos"). date/datetime/texto.
        fim_licenciamento: fim do licenciamento (propriedade 00107/00225 do
            Linx). date/datetime/texto.
        cert_status: 'ATIVO' | 'ENCERRADO' | None.

    Returns:
        Tupla (data_da_trava, origem) com origem em `TRAVA_ORIGEM_VALUES`, ou
        (None, None) quando nenhuma das duas datas é real. Empate de datas conta
        como 'certificacao': é a trava regulatória (Inmetro/Anatel), a que o
        fiscal precisa enxergar primeiro.
    """
    cert = None if cert_status == "ATIVO" else parse_data_real(fim_venda_certificacao)
    lic = parse_data_real(fim_licenciamento)
    if cert is None and lic is None:
        return None, None
    if cert is None:
        return lic, "licenciamento"
    if lic is None:
        return cert, "certificacao"
    return (cert, "certificacao") if cert <= lic else (lic, "licenciamento")


def derive_status_venda(
    cert_status: str | None,
    trava_venda: date | None,
    venda_encerramento: str | None = None,
    within_sale_deadline: bool = False,
    today: date | None = None,
    prazo_certificacao_conhecido: bool | None = None,
) -> str:
    """Status de venda — LIBERADA | BLOQUEADA (os dois valores que o banco aceita).

    Ordem de decisão:
    1. A aba "Encerramentos" declarou a venda bloqueada → BLOQUEADA.
    2. A trava já PASSOU → BLOQUEADA, ainda que o texto diga "Comercialização
       Permitida" (é o caso 050403179/050403180/PI6014Y: status permissivo com a
       data vencida; a data manda, decisão D11).
    3. Certificado encerrado SEM nenhuma evidência de venda permitida → BLOQUEADA
       (falso "liberado" é pior que falso "bloqueado" — o mesmo princípio que já
       rege `derive_venda_encerramento`).
    4. Caso contrário LIBERADA. A trava que vence HOJE ainda permite vender no dia,
       igual a `derive_within_sale_deadline`.

    Args:
        prazo_certificacao_conhecido: True quando o componente de CERTIFICAÇÃO da
            trava existe (data real de 'PRAZO FINAL VENDA'). É ele que a regra 3
            precisa olhar: `trava_venda` é o MÍNIMO entre certificação e
            licenciamento, então uma licença futura preenchia a trava e fazia o
            encerrado sem prazo nenhum de certificação sair LIBERADA. None (quem
            chama sem informar) mantém a leitura antiga, `trava_venda is not None`.
    """
    if cert_status not in CERT_STATUS_VALUES:
        return "BLOQUEADA"
    if venda_encerramento == "BLOQUEADA":
        return "BLOQUEADA"
    if trava_venda is not None and trava_venda < (today or _today_sp()):
        return "BLOQUEADA"
    if prazo_certificacao_conhecido is None:
        prazo_certificacao_conhecido = trava_venda is not None
    if cert_status != "ATIVO" and not within_sale_deadline and not prazo_certificacao_conhecido:
        return "BLOQUEADA"
    return "LIBERADA"


def derive_license_status_linx(
    fim_licenciamento: object, today: date | None = None
) -> tuple[str, str | None]:
    """Le prazo oficial do Linx; ausencia permanece pendente de aplicabilidade."""
    data = parse_data_real(fim_licenciamento)
    if data is None:
        return "PENDENTE", None
    vencido = data < (today or _today_sp())
    return ("VENCIDO" if vencido else "VALIDO"), data.isoformat()


def derive_licenciamento(
    fim_licenciamento: object,
    grife: object = None,
    linx_synced_at: object = None,
    aplicavel: bool | None = None,
    today: date | None = None,
) -> tuple[str, str | None, str | None]:
    """Eixo de licenciamento completo: status, prazo e motivo da pendência.

    Separa os três estados que a regra R8 da reunião de 11/09/2026 proíbe
    misturar — "Linx não lido", "sem licenciamento" e "vencido" — usando só
    colunas que já existem em `cert_products`:

    1. Data real em `linx_fim_licenciamento` → VALIDO | VENCIDO (a data manda,
       qualquer que seja a grife).
    2. `aplicavel` explícito (True/False) → respeitado. Nenhuma coluna do banco o
       alimenta hoje; existe para quem já sabe a resposta (testes, chamadores).
    3. `linx_synced_at` vazio → o Linx NÃO FOI LIDO para este SKU: PENDENTE, com
       motivo próprio. Não é "sem licenciamento".
    4. Linx lido, grife vazia ou igual a uma marca da casa (`MARCAS_DA_CASA`) →
       NAO_APLICAVEL: produto próprio, sem licenciador.
    5. Linx lido, grife de licenciador e nenhuma data → PENDENTE, citando a
       grife: é o caso que o time precisa cobrar no cadastro do Linx.

    Returns:
        Tupla (license_status, license_deadline_iso, reason). `reason` só vem
        preenchido quando o status é PENDENTE.
    """
    if parse_data_real(fim_licenciamento) is not None:
        status, deadline = derive_license_status_linx(fim_licenciamento, today)
        return status, deadline, None
    grife_txt = " ".join(str(grife or "").split())
    if aplicavel is False:
        return "NAO_APLICAVEL", None, None
    if aplicavel is None:
        if linx_synced_at is None or not str(linx_synced_at).strip():
            return "PENDENTE", None, LICENSE_REASON_LINX_NAO_LIDO
        if _norm_marca(grife_txt) in MARCAS_DA_CASA or not grife_txt:
            return "NAO_APLICAVEL", None, None
    licenciado = f"Produto licenciado ({grife_txt})" if grife_txt else "Produto licenciado"
    return "PENDENTE", None, f"{licenciado} sem vencimento no Linx"


def derive_comercializacao_status(
    cert_status: str,
    sale_deadline_raw: str | None,
    sheet_status: str | None,
    within_sale_deadline: bool = False,
    encerramento_status: str | None = None,
) -> str:
    """Status de comercialização (cobertura do "estatório de cessamento").

    Feedback 2026-07-16: cert encerrada com prazo vigente é DENTRO_PRAZO, não
    ENCERRADA — mesma regra que mantém o site_status CONFORME.

    Feedback 2026-08-07: quando a aba "Encerramentos" declara a venda
    (`encerramento_status`), ela decide — bloqueada é ENCERRADA e permitida é
    DENTRO_PRAZO, mesmo que o histórico de certificação diga outra coisa.
    """
    s = _norm(sheet_status)
    deadline = _norm(sale_deadline_raw)
    venda = derive_venda_encerramento(encerramento_status)
    if venda == "BLOQUEADA":
        return "ENCERRADA"
    if venda in ("PERMITIDA", "FIM_LOTE"):
        return "DENTRO_PRAZO"
    if cert_status == "ATIVO":
        # Ativo mas com SITUAÇÃO=Encerrado e prazo até final do lote = dentro do prazo
        if "encerrad" in s or _within_sale_window(sale_deadline_raw) or "fim de lote" in deadline:
            return "DENTRO_PRAZO"
        return "LIBERADA"
    if cert_status == "ENCERRADO":
        return "DENTRO_PRAZO" if within_sale_deadline else "ENCERRADA"
    return "NAO_APLICA"


# ---------- Orquestrador ----------

def _lookup_license_row(row: dict, license_map: dict | None) -> dict | None:
    """Casa o produto com uma linha da aba 'Licenciamentos Vencidos'.

    Tenta, em ordem, as chaves de identificação que o ERP usa para licenciamento:
    process_code, sku e código de processo embutido. As chaves são normalizadas
    em maiúsculas no `license_map` (ver `read_licenciamentos_vencidos`).
    """
    if not license_map:
        return None
    for key in ("process_code", "sku", "process_id", "code"):
        val = row.get(key)
        if val:
            hit = license_map.get(str(val).strip().upper())
            if hit:
                return hit
    return None


def compute_status_dimensions(
    row: dict, license_map: dict | None = None, today: date | None = None
) -> dict[str, str | None]:
    """Recebe um dict de cert_products (psycopg2 DictRow ou similar) e devolve
    os status semânticos como dict ready-to-merge no response.

    O caller é responsável por mesclar (ex.: `row.update(compute_status_dimensions(row))`).

    Args:
        row: linha de cert_products.
        license_map: mantido por compatibilidade de assinatura. Desde a D11 o
            licenciamento vem só do Linx (`derive_licenciamento`); a aba
            'Licenciamentos Vencidos' não decide mais nada aqui.
        today: data de referência do prazo de venda. Default: hoje em
            America/Sao_Paulo (`_today_sp()`);
            explicitável para deixar o cálculo determinístico em teste.
    """
    sheet_status = row.get("sheet_status")
    validade = parse_data_real(row.get("validade_certificado"))
    is_expired = bool(validade and validade < (today or _today_sp()))
    sale_deadline_raw = row.get("sale_deadline")
    certification_type = row.get("certification_type")
    expected_cert_text = row.get("expected_cert_text")
    last_vs = row.get("last_validation_status")
    encerramento_status = row.get("encerramento_status")
    situacao = row.get("situacao")

    # "SKU só em Encerramentos" (108 SKUs Puket em 11/09/2026) não tem linha em
    # nenhuma aba de produto e por isso nunca tem U. A linha do banco TEM a coluna
    # `situacao` (vazia); um dict de teste que nem traz a chave é outra coisa —
    # campo desconhecido — e continua decidindo pelo histórico. Por isso a
    # distinção entre chave ausente e chave presente-e-vazia é deliberada.
    somente_encerramentos = (
        "situacao" in row
        and not _norm(situacao)
        and bool(encerramento_status or sale_deadline_raw or row.get("sale_deadline_date"))
    )

    # `sale_deadline_date` e `today` precisam chegar aos DOIS eixos. Sem eles o
    # fallback de `derive_cert_status` só olhava o prazo TEXTUAL: para um produto
    # com texto não-parseável mas `sale_deadline_date` futuro, cert_status dava
    # ENCERRADO enquanto within_sale_deadline dava True — os dois eixos se
    # contradiziam na mesma linha da tabela.
    cs = derive_cert_status(
        sheet_status,
        is_expired,
        sale_deadline_raw,
        encerramento_status,
        row.get("sale_deadline_date"),
        today,
        situacao,
        somente_encerramentos,
    )
    certificado = re.sub(r"\s+", "", str(row.get("numero_certificado") or "")).upper()
    certificado_encerrado = re.sub(
        r"\s+", "", str(row.get("encerramento_numero_certificado") or "")
    ).upper()
    encerramento_do_ativo = (
        derive_situacao_status(situacao) == "ATIVO"
        and bool(certificado)
        and certificado == certificado_encerrado
    )
    # A identidade persistida permite distinguir o encerramento vigente de um
    # prazo residual do certificado antigo. Só o eixo comercial usa ENCERRADO;
    # `cert_status` continua refletindo a situação original da aba da marca.
    cert_status_comercial = "ENCERRADO" if encerramento_do_ativo else cs
    within_deadline = derive_within_sale_deadline(
        sheet_status,
        sale_deadline_raw,
        row.get("sale_deadline_date"),
        today,
        encerramento_status,
    )
    # Licenciamento vem exclusivamente do Linx. A aplicabilidade é DERIVADA de
    # `grife` + `linx_synced_at`: a coluna `licenciamento_aplicavel` nunca existiu
    # em cert_products, então lê-la sozinha dava PENDENTE para o catálogo inteiro.
    # O valor explícito segue respeitado quando o chamador o informa.
    fim_licenciamento = row.get("linx_fim_licenciamento")
    aplicavel = row.get("licenciamento_aplicavel")
    ls, ls_deadline, ls_reason = derive_licenciamento(
        fim_licenciamento,
        row.get("grife"),
        row.get("linx_synced_at"),
        aplicavel if isinstance(aplicavel, bool) else None,
        today,
    )
    # O site precisa enxergar a trava de licenciamento: sem isto, licença vencida
    # dava status_venda=BLOQUEADA com site_status=CONFORME na mesma linha.
    venda = derive_venda_encerramento(encerramento_status)
    ss, ss_reason = derive_site_status(
        last_vs, cert_status_comercial, expected_cert_text, certification_type, within_deadline,
        licenciamento_vencido=ls == "VENCIDO",
        venda_bloqueada_encerramento=venda == "BLOQUEADA",
    )
    cert_reason = None
    validade = parse_data_real(row.get("validade_certificado"))
    if cs == "ATIVO" and validade and validade < (today or _today_sp()):
        cert_reason = "Situacao ativa com validade vencida; resolver inconsistencia com Certificacao"
    elif derive_situacao_status(situacao) is None and not somente_encerramentos and (
        not sheet_status or (
            cs == "ENCERRADO" and not _tem_bloqueio(sheet_status)
            and not any(marker in _norm(sheet_status) for marker in ("encerrad", "vencid", "expired", "exclu", "andamento"))
            and not is_expired
        )
    ):
        cert_reason = "Situacao da certificacao nao informada; confirmar vinculo vigente"
    cms = derive_comercializacao_status(
        cert_status_comercial, sale_deadline_raw, sheet_status, within_deadline, encerramento_status
    )
    trava, trava_origem = derive_trava_venda(
        row.get("sale_deadline_date") or sale_deadline_raw, fim_licenciamento, cert_status_comercial
    )
    # O componente de CERTIFICAÇÃO sozinho, e não a trava (que é o mínimo com o
    # licenciamento): encerrado sem prazo final de venda conhecido não pode sair
    # LIBERADA só porque a licença é futura. "Vencido" escrito no prazo anula a
    # data que sobrou no banco, como já faz em `derive_within_sale_deadline`.
    prazo_certificacao_conhecido = "vencido" not in _norm(sale_deadline_raw) and (
        parse_data_real(row.get("sale_deadline_date")) or parse_data_real(sale_deadline_raw)
    ) is not None
    status_venda = derive_status_venda(
        cert_status_comercial, trava, venda, within_deadline, today, prazo_certificacao_conhecido
    )
    venda_reason = None
    # Licenciamento PENDENTE (Linx não lido, ou licenciado sem data) NÃO bloqueia
    # a venda nem torna a comercialização PENDENTE. R4: data vazia/NULL/1900 nunca
    # entra no mínimo nem bloqueia; R8: "não lido" não é "vencido". O status de
    # venda decorre só de datas e vereditos CONHECIDOS; a pendência fica visível
    # no eixo dela (`license_status` + `license_status_reason`). Até 18/09/2026
    # havia aqui um `if trava is None and ls == "PENDENTE": BLOQUEADA`, que exibia
    # falso bloqueio em ~95% do catálogo (produtos sem licenciador).
    if cert_reason:
        status_venda = "BLOQUEADA"
        venda_reason = cert_reason
    elif encerramento_do_ativo and not prazo_certificacao_conhecido and not within_deadline:
        venda_reason = "Mesmo certificado ativo e encerrado sem prazo de venda; confirmar com Certificacao"
    exclusao_vigente = _is_sku_excluded(situacao) or (
        derive_situacao_status(situacao) is None and _is_sku_excluded(sheet_status)
    )
    if exclusao_vigente or venda == "BLOQUEADA" or (trava is not None and trava < (today or _today_sp())):
        status_venda = "BLOQUEADA"
        venda_reason = None
    if venda_reason:
        cms = "PENDENTE"
    elif status_venda == "BLOQUEADA":
        cms = "ENCERRADA"
    elif trava is not None:
        cms = "DENTRO_PRAZO"
    if situacao == "PENDENTE_CADASTRO":
        # This is a read-model conflict, not an instruction to mutate the ERP.
        # Licensing remains independent: a known expired license still blocks.
        cs = "PENDENTE"
        cert_reason = str(sheet_status or "Conflito entre cadastro e planilha; confirmar vínculo vigente")
        cms = "PENDENTE"
        ss, ss_reason = "NAO_CONFORME", cert_reason
        within_deadline = False
        trava = parse_data_real(fim_licenciamento)
        trava_origem = "licenciamento" if trava else None
        status_venda = "BLOQUEADA" if ls == "VENCIDO" else "PENDENTE"
        venda_reason = cert_reason
    return {
        "cert_status": cs,
        "cert_status_reason": cert_reason,
        "site_status": ss,
        "site_status_reason": ss_reason,
        "license_status": ls,
        "license_status_reason": ls_reason,
        "license_deadline": ls_deadline,
        "comercializacao_status": cms,
        "venda_encerramento": venda,
        "within_sale_deadline": within_deadline,
        # D11 — eixo de VENDA, independente do status do certificado.
        "trava_venda": trava.isoformat() if trava else None,
        "trava_origem": trava_origem,
        "status_venda": status_venda,
        "status_venda_reason": venda_reason,
    }
