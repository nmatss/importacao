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

Sem efeitos colaterais; sem dependências externas; campos computados em runtime
(não persiste no DB). Pode ser usado direto em routes ou em report_service.
"""

from __future__ import annotations

from datetime import date, datetime

# Palavras-chave que indicam "produto regulado por órgão de certificação".
# Vem do scraper.py + cert_service.py (que já detecta inmetro/anatel/abnt/anvisa).
REGULATED_KEYWORDS = (
    "INMETRO", "ANATEL", "MAPA", "ANVISA", "ABNT", "OCP", "BRICS",
)


# ---------- Constantes / valores válidos ----------

CERT_STATUS_VALUES = {"ATIVO", "ENCERRADO"}
SITE_STATUS_VALUES = {"CONFORME", "NAO_CONFORME"}
LICENSE_STATUS_VALUES = {"VALIDO", "VENCIDO", "NAO_APLICAVEL"}
COMERCIALIZACAO_STATUS_VALUES = {"LIBERADA", "DENTRO_PRAZO", "ENCERRADA", "NAO_APLICA"}

# Frase obrigatória exibida na UI quando o site_status fica NAO_CONFORME por
# indefinição/erro de validação (não pode haver terceiro estado silencioso).
# Eduarda 2026-06-19 baniu a palavra "Pendente" como status; este é apenas a
# FRASE explicativa de um item NAO_CONFORME — usamos "a confirmar" para não dar
# impressão de um terceiro status remanescente.
SITE_REASON_PENDING = "Verificacao a confirmar - revisar"


# ---------- Helpers ----------

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
) -> bool:
    """True quando o produto ainda pode ser comercializado (prazo de venda vigente).

    Duas formas de prazo vigente:
    - Janela textual ("venda até o fim do lote") — sem data de corte.
    - Data futura ou de hoje em `sale_deadline_date` (inclusiva: no último dia
      ainda se pode vender).

    SKU excluído NUNCA está dentro do prazo — a regra da Eduarda (2026-06-19) põe
    a exclusão acima da janela de venda, e isso vale aqui também.

    "Vencido" escrito no prazo também manda, como já manda em `derive_cert_status`:
    o upsert do sync faz COALESCE em `sale_deadline_date` e nunca a limpa, então um
    item que passou a "Vencido" na planilha conserva a data antiga e não pode ser
    lido como vigente por causa dela.
    """
    if "exclu" in _norm(sheet_status):
        return False
    if "vencido" in _norm(sale_deadline_raw):
        return False
    if _within_sale_window(sale_deadline_raw):
        return True
    deadline = _parse_deadline_date(sale_deadline_date) or _parse_deadline_date(sale_deadline_raw)
    if deadline is None:
        return False
    return deadline >= (today or date.today())


def derive_cert_status(
    sheet_status: str | None,
    is_expired: bool | None,
    sale_deadline_raw: str | None,
) -> str:
    """Status da certificação — colapsado em ATIVO | ENCERRADO.

    Feedback Eduarda 2026-06-19:
    - "Ativo": certificação ativa OU dentro do prazo de venda.
    - "Encerrado": certificação encerrada, SKU excluído OU fora do prazo de venda.

    Mapeamento:
    - SKU excluído                  → ENCERRADO
    - Em andamento                  → ENCERRADO (a menos que claramente ativo
                                       por prazo de venda vigente)
    - Expired / Vencido / Encerrado → ENCERRADO, salvo dentro da janela de venda
    - Ativo / Finalizado / Expiring → ATIVO, salvo expirado e fora da janela
    - Texto livre / desconhecido    → conservador: ENCERRADO se expirado e fora
                                       da janela; senão ATIVO por prazo
    """
    s = _norm(sheet_status)
    within_window = _within_sale_window(sale_deadline_raw)
    deadline = _norm(sale_deadline_raw)

    # SKU excluído → SEMPRE encerrado (regra explícita Eduarda: "Encerrado =
    # certificação encerrada, SKU excluído OU fora do prazo de venda"). Precede o
    # short-circuit de janela de venda: um SKU excluído nunca volta a ATIVO mesmo
    # com prazo de venda vigente.
    if "exclu" in s:
        return "ENCERRADO"

    # Dentro da janela de venda reativa (após excluir SKUs excluídos).
    if within_window:
        return "ATIVO"

    # Em andamento → conservador ENCERRADO (sem flag clara de atividade);
    # a janela de venda já foi tratada acima.
    if "andamento" in s:
        return "ENCERRADO"

    # Marcadores explícitos de encerramento.
    if s == "expired" or "vencid" in s or "encerrad" in s:
        return "ENCERRADO"

    # Marcadores explícitos de atividade — só permanecem ATIVO se não houver
    # sinal concreto de expiração ("Ativo" obsoleto + vencido → ENCERRADO).
    if s == "ativo" or "finalizad" in s or s == "expiring":
        if is_expired or "vencido" in deadline:
            return "ENCERRADO"
        return "ATIVO"

    # sheet_status vazio ou texto livre histórico → deduz pelos sinais binários,
    # de forma conservadora (default ENCERRADO quando não claramente ativo).
    return _fallback_from_expiration(is_expired, sale_deadline_raw)


def _fallback_from_expiration(is_expired: bool | None, sale_deadline_raw: str | None) -> str:
    """Quando sheet_status é vazio/texto livre, deduz pelos sinais binários.

    Conservador: ENCERRADO quando vencido/expirado; ATIVO apenas com prazo
    vigente explícito ou janela de venda aberta.
    """
    if _within_sale_window(sale_deadline_raw):
        return "ATIVO"
    deadline = _norm(sale_deadline_raw)
    if "vencido" in deadline:
        return "ENCERRADO"
    if is_expired:
        return "ENCERRADO"
    if deadline:
        # Tem prazo estruturado e não está vencido → dentro do prazo.
        return "ATIVO"
    # Sem qualquer sinal de prazo nem certificação ativa → conservador ENCERRADO.
    return "ENCERRADO"


def derive_site_status(
    last_validation_status: str | None,
    cert_status: str,
    expected_cert_text: str | None,
    certification_type: str | None,
    within_sale_deadline: bool = False,
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


def derive_comercializacao_status(
    cert_status: str,
    sale_deadline_raw: str | None,
    sheet_status: str | None,
    within_sale_deadline: bool = False,
) -> str:
    """Status de comercialização (cobertura do "estatório de cessamento").

    Feedback 2026-07-16: cert encerrada com prazo vigente é DENTRO_PRAZO, não
    ENCERRADA — mesma regra que mantém o site_status CONFORME.
    """
    s = _norm(sheet_status)
    deadline = _norm(sale_deadline_raw)
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
        license_map: dict opcional {PROCESS_CODE/SKU(upper) -> {status, valid_until}}
            vindo de `erp_service.read_licenciamentos_vencidos()`. Quando None ou
            sem match, license_status defaulta para NAO_APLICAVEL.
        today: data de referência do prazo de venda. Default `date.today()`;
            explicitável para deixar o cálculo determinístico em teste.
    """
    sheet_status = row.get("sheet_status")
    is_expired = bool(row.get("is_expired") or False)
    sale_deadline_raw = row.get("sale_deadline")
    certification_type = row.get("certification_type")
    expected_cert_text = row.get("expected_cert_text")
    last_vs = row.get("last_validation_status")

    cs = derive_cert_status(sheet_status, is_expired, sale_deadline_raw)
    within_deadline = derive_within_sale_deadline(
        sheet_status, sale_deadline_raw, row.get("sale_deadline_date"), today
    )
    ss, ss_reason = derive_site_status(
        last_vs, cs, expected_cert_text, certification_type, within_deadline
    )
    ls, ls_deadline = derive_license_status(_lookup_license_row(row, license_map))
    cms = derive_comercializacao_status(cs, sale_deadline_raw, sheet_status, within_deadline)
    return {
        "cert_status": cs,
        "site_status": ss,
        "site_status_reason": ss_reason,
        "license_status": ls,
        "license_deadline": ls_deadline,
        "comercializacao_status": cms,
    }
