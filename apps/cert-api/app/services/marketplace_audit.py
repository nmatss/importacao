"""Auditoria dos quebra-cabecas de sellers terceiros no marketplace Imaginarium.

Decisao da reuniao de 11/09/2026: "trazer todos os quebra-cabecas e colocar a
informacao se esta ok ou nao". O veredito reflete a EVIDENCIA publicada no site
(informacao de certificado presente ou nao), e so ela. O criterio de 500 pecas
foi citado, mas NAO aprovado: a contagem de pecas e informativa, nunca dispensa
um item, e `NAO_EXIGE` nao e atribuido automaticamente por este servico.
Numero de registro presente nao comprova autenticidade.

O validador existente so percorre os SKUs de `cert_products`, ou seja, o
catalogo da planilha: item de marketplace NUNCA entrava. Este servico audita por
CATEGORIA, lendo a VTEX publica (GET sem credencial, com o mesmo
`VTEX_REQUEST_DELAY` das demais leituras) e escrevendo apenas em
`cert_marketplace_items`.

Nada aqui escreve na VTEX, no Linx ou na planilha.
"""

import re
import time
import uuid
from datetime import UTC, datetime

import requests

from app.config import VTEX_REQUEST_DELAY, VTEX_STORES
from app.db.postgres import db
from app.services.cert_service import has_registration_number, strip_html
from app.utils.logging import log

# O seller `1` e a propria loja (item de catalogo proprio, coberto pelo painel).
HOUSE_SELLER_ID = "1"

DEFAULT_CATEGORY_PATH = "category-1/jogos/category-2/quebra-cabeca"
# K4 (SSRF/path traversal): o caminho da categoria entra no PATH da URL lida
# pelo servidor. Allow-list de formato, nunca block-list: so segmentos
# minusculos/digitos/hifen separados por UMA barra. Fica de fora tudo o que o
# `requests` normalizaria ou reinterpretaria: `..`, `.`, `?`, `#`, `%`, `\`,
# barra inicial/final/dupla, esquema e espaco.
_CATEGORY_PATH_RE = re.compile(r"[a-z0-9-]+(?:/[a-z0-9-]+)*")
_MAX_CATEGORY_PATH_CHARS = 200
_PAGE_SIZE = 50
_MAX_PAGES = 20

# K6: uma pagina que falha por motivo TRANSITORIO ganha no maximo 2 novas
# tentativas, com espera crescente (2s, 4s). Esgotadas, a leitura inteira falha:
# inventario parcial nunca e devolvido como completo. Pior caso por pagina:
# 3 x (5s conexao + 20s leitura) + 6s de espera.
_MAX_RETRIES_PER_PAGE = 2
_RETRY_BACKOFF_SECONDS = 2.0
_REQUEST_TIMEOUT = (5, 20)
# 4xx (404, 403) nao melhora com insistencia e so castigaria o site.
_RETRYABLE_STATUS = frozenset({408, 425, 429, 500, 502, 503, 504})

# K10: so o numero IMEDIATAMENTE antes da unidade (pecas/pcs/pçs). O padrao
# antigo `\d[\d.\s]*` colava numeros vizinhos: "2 em 1 500 pecas" virava 1500 e
# "Panorama 2 1000 pecas" virava 21000. Milhar com ponto e aceito ("1.000");
# com ESPACO so quando o grupo e "000" ("2 000"), a unica leitura possivel —
# "1 500 pecas" e ambiguo ("2 em 1", "kit 1") e fica com o numero colado: 500.
_PIECES_RE = re.compile(
    r"(?<![\d.,])(\d{1,3}(?:\.\d{3})+|\d{1,3}(?:\s000)+|\d+)\s*(?:pe[çc]as?|p[çc]s)\b",
    re.IGNORECASE,
)
# Acima disto e erro de cadastro, e estouraria a coluna INTEGER na gravacao.
_MAX_PIECES = 100_000
# K3: a evidencia pode estar em QUALQUER especificacao cujo nome ou valor cite
# "inmetro" ("Certificacao Inmetro", "Registro Inmetro", "Inmetro"...) ou na
# descricao do produto — nao so na especificacao de nome canonico.
_INMETRO_RE = re.compile(r"inmetro", re.IGNORECASE)
# Da descricao so vale o TRECHO em volta da mencao: rodar o detector de numero
# de registro na descricao inteira transformaria SAC, lote ou dimensao em "OK",
# e um OK falso e o erro caro aqui (o time deixaria de olhar o item).
_DESCRIPTION_CHARS_BEFORE = 80
_DESCRIPTION_CHARS_AFTER = 200
_MAX_EVIDENCE_CHARS = 600
# Especificacoes que costumam trazer a contagem quando o nome nao traz.
_PIECES_SPEC_NAMES = ("componentes", "número de peças", "numero de pecas", "quantidade de peças")

# Texto que os sellers usam para declarar que o item esta dispensado. Dispensa
# declarada pelo seller NUNCA vira veredito automatico: vai para conferencia.
_NAO_POSSUI_RE = re.compile(
    r"n[ãa]o\s+(?:possui|se\s+aplica|aplic[áa]vel|exige|necessita|requer|precisa|tem\b)"
    r"|\bisent[oa]s?\b|\bisen[çc][ãa]o\b|\bdispensad[oa]s?\b|\bdispensa\b",
    re.IGNORECASE,
)

# Codigo de registro no formato que aparece NESTA especificacao, do tipo
# "CE-BRI/ICEPEX-N 01264-25". `cert_service.has_registration_number` cobre os
# formatos da descricao do produto, mas o padrao dele (`ce-\w+[\s/]\w+\s+\d{3,}`)
# nao aceita o sufixo hifenizado do organismo e deixaria de fora justamente o
# formato mais comum na categoria — por isso este regex vem ANTES, e o helper
# compartilhado fica como complemento (nao foi alterado: e usado pelo validador
# do catalogo proprio).
_REGISTRATION_RE = re.compile(
    r"ce[-\s][\w./\s-]*?\d{3,}|\bocp\s*\d{3,}|\d{4,}[/-]\d{2,4}", re.IGNORECASE
)


class MarketplaceAuditError(Exception):
    """Falha de auditoria cuja MENSAGEM pode ir para a tela.

    So as subclasses daqui tem texto escrito por nos; qualquer outra excecao
    pode carregar URL, SQL ou credencial e so expoe o nome do tipo.
    """


class EmptyCategoryError(MarketplaceAuditError):
    """A loja respondeu 200, mas a categoria nao tem nenhum produto (K7)."""

    def __init__(self) -> None:
        super().__init__(
            "A loja não devolveu nenhum produto para a categoria de quebra-cabeças. "
            "A categoria pode ter sido renomeada no site. Nada foi gravado: a lista "
            "abaixo continua sendo a da auditoria anterior."
        )


def has_certification_code(text: str) -> bool:
    """True quando o texto traz um numero de registro reconhecivel."""
    return bool(_REGISTRATION_RE.search(text or "")) or has_registration_number(text or "")


def parse_pieces(text: str) -> int | None:
    """Extrai a quantidade de pecas de um texto ('Puzzle 500 pecas' -> 500).

    Returns:
        O numero, ou None quando o texto nao declara pecas.
    """
    match = _PIECES_RE.search(text or "")
    if not match:
        return None
    digits = re.sub(r"\D", "", match.group(1))
    if not digits:
        return None
    pieces = int(digits)
    return pieces if 0 < pieces <= _MAX_PIECES else None


def _spec_values(product: dict) -> list[tuple[str, str]]:
    """Pares (nome, valor) de properties e specificationGroups do produto."""
    out: list[tuple[str, str]] = []
    for prop in product.get("properties") or []:
        if isinstance(prop, dict):
            for value in prop.get("values") or []:
                out.append((str(prop.get("name", "")), strip_html(str(value))))
    for group in product.get("specificationGroups") or []:
        if isinstance(group, dict):
            for spec in group.get("specifications") or []:
                if isinstance(spec, dict):
                    for value in spec.get("values") or []:
                        out.append((str(spec.get("name", "")), strip_html(str(value))))
    return out


def _description_snippets(product: dict) -> list[str]:
    """Trechos da descricao do produto em volta de cada mencao a "inmetro"."""
    raw = product.get("description")
    if not isinstance(raw, str) or not raw:
        return []
    text = strip_html(raw)
    trechos: list[str] = []
    fim_anterior = -1
    for match in _INMETRO_RE.finditer(text):
        if match.start() < fim_anterior:
            continue  # mencao ja coberta pelo trecho anterior
        inicio = max(0, match.start() - _DESCRIPTION_CHARS_BEFORE)
        fim_anterior = min(len(text), match.end() + _DESCRIPTION_CHARS_AFTER)
        trechos.append(text[inicio:fim_anterior].strip())
    return trechos


def extract_inmetro_text(product: dict) -> str:
    """Evidencia de certificacao Inmetro publicada no site para o produto.

    Junta, sem repetir: o valor de toda especificacao cujo nome ou valor cite
    "inmetro" e os trechos da descricao em volta da mencao. Vazio significa
    "nada preenchido em texto" — selo que so aparece em IMAGEM nao e
    detectavel por esta leitura.
    """
    achados: list[str] = []
    for name, value in _spec_values(product):
        value = value.strip()
        if value and (_INMETRO_RE.search(name) or _INMETRO_RE.search(value)):
            achados.append(value)
    achados.extend(_description_snippets(product))
    unicos = list(dict.fromkeys(a for a in achados if a))
    return " | ".join(unicos)[:_MAX_EVIDENCE_CHARS]


def extract_pieces(product: dict) -> int | None:
    """Quantidade de pecas, do nome ou das especificacoes de componentes."""
    from_name = parse_pieces(str(product.get("productName") or product.get("name") or ""))
    if from_name is not None:
        return from_name
    for name, value in _spec_values(product):
        if any(alias in name.lower().strip() for alias in _PIECES_SPEC_NAMES):
            pieces = parse_pieces(value)
            if pieces is not None:
                return pieces
    return None


def _available_quantity(offer: dict) -> int:
    """Estoque do seller como inteiro.

    A VTEX ja devolveu numero, string e string fracionaria ("3.0"); `int("3.0")`
    levantava ValueError e derrubava o lote inteiro. Valor que nao e numero
    levanta ValueError de proposito: o item vai para "nao verificado", em vez
    de ser escondido como "sem estoque".
    """
    raw = offer.get("AvailableQuantity")
    if raw is None or raw == "":
        return 0
    if isinstance(raw, bool):
        raise ValueError("AvailableQuantity booleano")
    if isinstance(raw, int):
        return raw
    number = float(str(raw).strip().replace(",", "."))
    if number != number or number in (float("inf"), float("-inf")):
        raise ValueError("AvailableQuantity nao finito")
    return int(number)


def third_party_sellers(product: dict) -> list[dict]:
    """Sellers terceiros com estoque para o produto.

    Returns:
        Lista `[{'id': ..., 'name': ...}]` sem o seller da casa e sem os
        esgotados (AvailableQuantity 0), na ordem em que a VTEX devolveu.
    """
    out: list[dict] = []
    vistos: set[str] = set()
    for item in product.get("items") or []:
        if not isinstance(item, dict):
            continue
        for seller in item.get("sellers") or []:
            if not isinstance(seller, dict):
                continue
            seller_id = str(seller.get("sellerId") or "").strip()
            if not seller_id or seller_id == HOUSE_SELLER_ID or seller_id in vistos:
                continue
            offer = seller.get("commertialOffer")
            if _available_quantity(offer if isinstance(offer, dict) else {}) <= 0:
                continue
            vistos.add(seller_id)
            out.append({"id": seller_id, "name": str(seller.get("sellerName") or "").strip()})
    return out


def classify(name: str, pieces: int | None, cert_text: str) -> tuple[str, str]:
    """Da o "ok ou nao" de um item pela evidencia publicada no site.

    - informacao de certificado com numero/registro reconhecivel -> OK;
    - nenhuma informacao de certificado -> NAO_OK;
    - texto sem numero reconhecivel, ou declaracao de dispensa/isencao -> REVISAR.

    `pieces` so entra no motivo, como informacao: a regra de 500 pecas nao foi
    aprovada e nenhuma contagem muda o veredito. `NAO_EXIGE` nunca sai daqui.

    Returns:
        Tupla `(verdict, reason)` com verdict em OK | NAO_OK | REVISAR.
    """
    quantas = f"{pieces} peças" if pieces is not None else "quantidade de peças não informada"
    texto = (cert_text or "").strip()
    if not texto:
        verdict = "NAO_OK"
        evidencia = "Especificação de certificação não preenchida no site"
    elif _NAO_POSSUI_RE.search(texto):
        verdict = "REVISAR"
        evidencia = "Site declara dispensa de certificação, ainda não validada pelo time fiscal"
    elif has_certification_code(texto):
        verdict = "OK"
        evidencia = "Número de registro informado no site; autenticidade não verificada"
    else:
        verdict = "REVISAR"
        evidencia = "Informação de certificação presente no site, sem número de registro reconhecível"
    return verdict, f"{evidencia}. Informativo: {quantas}."


def is_valid_category_path(category_path: object) -> bool:
    """True quando o caminho da categoria cabe na allow-list de formato.

    `fullmatch`, e nao `match` com `$`: em Python `$` aceita um `\n` final.
    """
    return (
        isinstance(category_path, str)
        and 0 < len(category_path) <= _MAX_CATEGORY_PATH_CHARS
        and _CATEGORY_PATH_RE.fullmatch(category_path) is not None
    )


def _store_config() -> dict[str, str]:
    """Config da loja Imaginarium (dominio publico e URL base)."""
    return VTEX_STORES["imaginarium"]


def _get_page(url: str, page: int, page_size: int, headers: dict[str, str]) -> requests.Response:
    """Le UMA pagina, com retry limitado para falha transitoria.

    Raises:
        requests.RequestException: falha definitiva (4xx/30x) ou transitoria que
            sobreviveu a `_MAX_RETRIES_PER_PAGE` novas tentativas.
    """
    erro = requests.RequestException(f"Inventario marketplace incompleto: pagina {page}")
    for attempt in range(_MAX_RETRIES_PER_PAGE + 1):
        if attempt:
            time.sleep(_RETRY_BACKOFF_SECONDS * (2 ** (attempt - 1)))
        try:
            # Redirect nunca e seguido: um 30x do site (ou de um path forjado)
            # nao pode levar esta leitura para outro host.
            resp = requests.get(
                url,
                params={"page": page, "count": page_size},
                headers=headers,
                timeout=_REQUEST_TIMEOUT,
                allow_redirects=False,
            )
        except requests.RequestException as e:
            # So o TIPO do erro: a mensagem do `requests` carrega a URL completa.
            erro = requests.RequestException(
                f"Inventario marketplace incompleto: pagina {page} indisponivel ({type(e).__name__})"
            )
            log.warning(
                f"Marketplace audit: pagina {page} tentativa {attempt + 1} falhou ({type(e).__name__})"
            )
            continue
        if resp.status_code == 200:
            return resp
        erro = requests.RequestException(
            f"Inventario marketplace incompleto: pagina {page} HTTP {resp.status_code}"
        )
        if resp.status_code not in _RETRYABLE_STATUS:
            break
        log.warning(
            f"Marketplace audit: pagina {page} tentativa {attempt + 1} HTTP {resp.status_code}"
        )
    raise erro


def fetch_category_products(
    category_path: str = DEFAULT_CATEGORY_PATH,
    page_size: int = _PAGE_SIZE,
    max_pages: int = _MAX_PAGES,
    sleep: float | None = None,
) -> list[dict]:
    """Pagina a busca publica da VTEX por categoria (somente leitura).

    A paginacao para quando a pagina volta com menos produtos que o tamanho
    pedido — a API nao garante um total confiavel — e sempre no teto de
    `max_pages`, para que uma categoria inesperadamente grande nao vire um
    request infinito. Cada pagina tem retry limitado (`_get_page`).

    Raises:
        ValueError: `category_path` fora da allow-list (defesa em profundidade;
            a rota ja responde 400 antes de chegar aqui).
        requests.RequestException: qualquer pagina indisponivel ou leitura
            incompleta; nenhum inventario parcial e retornado como completo.
    """
    if not is_valid_category_path(category_path):
        raise ValueError("Caminho de categoria invalido")
    delay = VTEX_REQUEST_DELAY if sleep is None else sleep
    domain = _store_config()["domain"]
    url = f"https://{domain}/api/io/_v/api/intelligent-search/product_search/{category_path}"
    headers = {"Accept": "application/json", "User-Agent": "CertAPI/2.0"}

    if page_size < 1 or max_pages < 1:
        raise ValueError("page_size e max_pages devem ser positivos")
    produtos: list[dict] = []
    for page in range(max_pages):
        if page and delay:
            time.sleep(delay)
        resp = _get_page(url, page + 1, page_size, headers)
        payload = resp.json()
        if not isinstance(payload, dict) or not isinstance(payload.get("products"), list):
            raise requests.RequestException(f"Inventario marketplace invalido: pagina {page + 1} sem lista products")
        lote = payload["products"]
        produtos.extend(lote)
        if len(lote) < page_size:
            break
    else:
        raise requests.RequestException("Inventario marketplace incompleto: teto de paginas atingido")

    return produtos


def _audit_one(product: dict, site_url: str) -> dict | None:
    """Linha de UM produto, ou None quando nao ha seller terceiro com estoque."""
    sellers = third_party_sellers(product)
    if not sellers:
        return None
    name = str(product.get("productName") or product.get("name") or "")
    pieces = extract_pieces(product)
    cert_text = extract_inmetro_text(product)
    verdict, reason = classify(name, pieces, cert_text)
    link = str(product.get("link") or "")
    if not link:
        link_text = str(product.get("linkText") or "")
        link = f"{site_url}/{link_text}/p" if link_text else ""
    elif not link.startswith("http"):
        link = f"{site_url}{link}"
    return {
        "vtex_product_id": str(product.get("productId") or product.get("id") or ""),
        "seller_id": sellers[0]["id"],
        "seller_name": sellers[0]["name"],
        "name": name,
        "url": link,
        "pieces": pieces,
        "cert_text": cert_text or None,
        "verdict": verdict,
        "reason": reason,
    }


def _unverified_row(product: object, error: Exception) -> dict | None:
    """Linha REVISAR para um item que nao pode ser lido, se ele for identificavel.

    Sem `productId` nao ha o que gravar (`vtex_product_id` e NOT NULL e a linha
    nao levaria o time a lugar nenhum): o item so entra na contagem.
    """
    if not isinstance(product, dict):
        return None
    product_id = str(product.get("productId") or product.get("id") or "").strip()
    if not product_id:
        return None
    name = product.get("productName") or product.get("name")
    return {
        "vtex_product_id": product_id,
        "seller_id": None,
        "seller_name": None,
        "name": str(name) if isinstance(name, str) else None,
        "url": "",
        "pieces": None,
        "cert_text": None,
        "verdict": "REVISAR",
        "reason": (
            "Item não verificado: os dados do produto vieram malformados do site "
            f"({type(error).__name__}). Conferir manualmente."
        ),
    }


def audit_batch(products: list) -> tuple[list[dict], int]:
    """Classifica o lote isolando cada item (K5).

    Um produto malformado (`None`, estoque que nao e numero, campo de tipo
    inesperado) NAO derruba os demais: e contado, logado e — quando
    identificavel — gravado como REVISAR "nao verificado". E a mesma classe de
    defeito que parou o sync da planilha por 6 dias por causa de uma linha.

    Returns:
        `(linhas, nao_verificados)`.
    """
    site_url = _store_config()["site_url"]
    linhas: list[dict] = []
    nao_verificados = 0
    for index, product in enumerate(products):
        try:
            if not isinstance(product, dict):
                raise TypeError(f"produto nao e objeto: {type(product).__name__}")
            linha = _audit_one(product, site_url)
        except Exception as e:  # noqa: BLE001 - isolamento por item e o objetivo
            nao_verificados += 1
            log.warning(
                f"Marketplace audit: item {index} nao verificado ({type(e).__name__})"
            )
            linha = _unverified_row(product, e)
        if linha is not None:
            linhas.append(linha)
    return linhas, nao_verificados


def audit_products(products: list[dict]) -> list[dict]:
    """Classifica os produtos de marketplace de uma lista ja lida da VTEX.

    Funcao PURA: e ela que os testes exercitam com as respostas reais salvas da
    VTEX, sem rede.

    Returns:
        Uma linha por produto de seller terceiro, pronta para
        `cert_marketplace_items`. Produtos so do seller da casa ficam de fora.
        Para saber quantos itens nao puderam ser lidos, use `audit_batch`.
    """
    return audit_batch(products)[0]


def persist_audit(rows: list[dict], run_id: str) -> int:
    """Grava as linhas da auditoria com o id da execucao.

    Linhas antigas NAO sao apagadas: a tela lista sempre a ultima execucao, e o
    historico serve para mostrar quando um item deixou de estar conforme.
    """
    if not rows:
        return 0
    with db() as (conn, cur):
        for row in rows:
            cur.execute(
                """
                INSERT INTO cert_marketplace_items
                    (vtex_product_id, seller_id, seller_name, name, url, pieces,
                     cert_text, verdict, reason, checked_at, run_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                [
                    row["vtex_product_id"], row["seller_id"], row["seller_name"],
                    row["name"], row["url"], row["pieces"], row["cert_text"],
                    row["verdict"], row["reason"], datetime.now(UTC), run_id,
                ],
            )
    return len(rows)


def summarize(rows: list[dict]) -> dict[str, int]:
    """Contagem por veredito, com as quatro chaves sempre presentes."""
    counts = {"OK": 0, "NAO_OK": 0, "REVISAR": 0, "NAO_EXIGE": 0}
    for row in rows:
        counts[row["verdict"]] = counts.get(row["verdict"], 0) + 1
    return counts


def run_audit(
    category_path: str = DEFAULT_CATEGORY_PATH,
    persist: bool = True,
) -> dict:
    """Le a categoria na VTEX, classifica e (opcionalmente) grava.

    Raises:
        EmptyCategoryError: a categoria veio sem nenhum produto.
        requests.RequestException: leitura indisponivel ou incompleta.

    Returns:
        Dict com `run_id`, `total`, `scanned`, `unverified`, `summary` e `items`.
    """
    run_id = str(uuid.uuid4())
    produtos = fetch_category_products(category_path)
    if not produtos:
        # K7: "li e veio vazio" nao e sucesso. Sem linha gravada, a tela seguiria
        # mostrando a execucao antiga como a ultima, com toast de "concluida".
        raise EmptyCategoryError()
    linhas, nao_verificados = audit_batch(produtos)
    if persist:
        persist_audit(linhas, run_id)
    log.info(
        f"Marketplace audit {run_id}: {len(produtos)} produto(s) lido(s), "
        f"{len(linhas)} de seller terceiro, {nao_verificados} nao verificado(s)"
    )
    return {
        "run_id": run_id,
        "total": len(linhas),
        "scanned": len(produtos),
        "unverified": nao_verificados,
        "summary": summarize(linhas),
        "items": linhas,
    }
