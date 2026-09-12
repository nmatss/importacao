"""Auditoria dos quebra-cabecas de sellers terceiros no marketplace Imaginarium.

Pedido da reuniao de 11/09/2026 (item 6): quebra-cabeca com MENOS de 500 pecas
exige certificacao Inmetro (Portaria de brinquedos); a partir de 500 nao exige.
A loja Imaginarium vende esses itens por marketplace — 173 produtos da categoria
`jogos/quebra-cabeca` em 11/09, todos da marca "Grow Jogos" ofertados pelo
seller `lojagrow`, enquanto o seller `1` (a propria Imaginarium) aparece com
estoque zero.

O validador existente so percorre os SKUs de `cert_products`, ou seja, o
catalogo da planilha: item de marketplace NUNCA entrava. Este servico audita por
CATEGORIA, lendo a VTEX publica (GET sem credencial, com o mesmo
`VTEX_REQUEST_DELAY` das demais leituras) e escrevendo apenas em
`cert_marketplace_items`.

Nada aqui escreve na VTEX, no Linx ou na planilha.
"""

import re
import uuid
from datetime import UTC, datetime

import requests

from app.config import VTEX_REQUEST_DELAY, VTEX_STORES
from app.db.postgres import db
from app.services.cert_service import has_registration_number, strip_html
from app.utils.logging import log

# A regra fiscal e "< 500 pecas exige"; 500 exatas NAO exigem. O valor fica
# parametrizavel porque a fronteira (< ou <=) ainda depende de confirmacao do
# time fiscal — ver open_questions da reuniao.
DEFAULT_PIECES_THRESHOLD = 500

# O seller `1` e a propria loja (item de catalogo proprio, coberto pelo painel).
HOUSE_SELLER_ID = "1"

DEFAULT_CATEGORY_PATH = "category-1/jogos/category-2/quebra-cabeca"
_PAGE_SIZE = 50
_MAX_PAGES = 20

_PIECES_RE = re.compile(r"(\d[\d.\s]*)\s*pe[çc]as?\b", re.IGNORECASE)
_INMETRO_SPEC_NAMES = ("certificação inmetro", "certificacao inmetro")
# Especificacoes que costumam trazer a contagem quando o nome nao traz.
_PIECES_SPEC_NAMES = ("componentes", "número de peças", "numero de pecas", "quantidade de peças")

# Acessorios da categoria que NAO sao brinquedo-quebra-cabeca (porta-puzzle,
# cola, moldura). Sem esta lista eles cairiam como "sem numero de pecas" e
# poluiriam a fila de revisao do time fiscal.
_ACCESSORY_RE = re.compile(r"^\s*(porta[-\s]|suporte\b|cola\b|moldura\b|tapete\b)", re.IGNORECASE)

# Texto que os sellers usam para declarar que o item esta dispensado.
_NAO_POSSUI_RE = re.compile(r"n[ãa]o\s+possui", re.IGNORECASE)

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
    try:
        return int(digits)
    except ValueError:
        return None


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


def extract_inmetro_text(product: dict) -> str:
    """Texto da especificacao 'Certificacao Inmetro' do produto, se houver."""
    for name, value in _spec_values(product):
        if any(alias in name.lower().strip() for alias in _INMETRO_SPEC_NAMES) and value:
            return value
    return ""


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
            offer = seller.get("commertialOffer") or {}
            if int(offer.get("AvailableQuantity") or 0) <= 0:
                continue
            vistos.add(seller_id)
            out.append({"id": seller_id, "name": str(seller.get("sellerName") or "").strip()})
    return out


def classify(
    name: str, pieces: int | None, cert_text: str, threshold: int = DEFAULT_PIECES_THRESHOLD
) -> tuple[str, str]:
    """Aplica a regra de certificacao a um item de marketplace.

    Returns:
        Tupla `(verdict, reason)` com verdict em
        OK | NAO_OK | REVISAR | NAO_EXIGE.
    """
    if _ACCESSORY_RE.search(name or ""):
        return "NAO_EXIGE", "Acessorio, nao e quebra-cabeca"
    if pieces is not None and pieces >= threshold:
        return "NAO_EXIGE", f"{pieces} pecas (a partir de {threshold} nao exige certificacao)"

    limite = f"menos de {threshold} pecas"
    quantas = f"{pieces} pecas" if pieces is not None else "quantidade de pecas nao informada"

    if not cert_text.strip():
        if pieces is None:
            # Sem saber quantas pecas, "sem certificacao" nao prova infracao:
            # vai para revisao humana, nunca para OK.
            return "REVISAR", "Sem numero de pecas e sem informacao de certificacao no site"
        return "NAO_OK", f"{quantas} ({limite} exige certificacao) e nenhuma informacao no site"

    if _NAO_POSSUI_RE.search(cert_text):
        if pieces is None:
            return "REVISAR", "O site declara dispensa, mas o numero de pecas nao foi identificado"
        return "NAO_OK", f"{quantas}, mas o site declara que nao possui certificacao"

    if has_certification_code(cert_text):
        if pieces is None:
            return "REVISAR", "Certificacao informada, mas o numero de pecas nao foi identificado"
        return "OK", f"{quantas} com numero de registro informado"

    return "REVISAR", "Texto de certificacao sem numero de registro reconhecivel"


def _store_config() -> dict[str, str]:
    """Config da loja Imaginarium (dominio publico e URL base)."""
    return VTEX_STORES["imaginarium"]


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
    request infinito.

    Raises:
        requests.RequestException: falha de rede na primeira pagina; paginas
            seguintes degradam para o que ja foi lido.
    """
    import time

    delay = VTEX_REQUEST_DELAY if sleep is None else sleep
    domain = _store_config()["domain"]
    url = f"https://{domain}/api/io/_v/api/intelligent-search/product_search/{category_path}"
    headers = {"Accept": "application/json", "User-Agent": "CertAPI/2.0"}

    produtos: list[dict] = []
    for page in range(max_pages):
        if page and delay:
            time.sleep(delay)
        try:
            resp = requests.get(
                url, params={"page": page + 1, "count": page_size}, headers=headers, timeout=20
            )
        except requests.RequestException:
            if page == 0:
                raise
            log.warning(f"Marketplace audit: page {page + 1} failed, keeping {len(produtos)} items")
            break
        if resp.status_code != 200:
            if page == 0:
                resp.raise_for_status()
            break
        lote = resp.json().get("products") or []
        produtos.extend(lote)
        if len(lote) < page_size:
            break
    return produtos


def audit_products(products: list[dict], threshold: int = DEFAULT_PIECES_THRESHOLD) -> list[dict]:
    """Classifica os produtos de marketplace de uma lista ja lida da VTEX.

    Funcao PURA: e ela que os testes exercitam com as respostas reais salvas da
    VTEX, sem rede.

    Returns:
        Uma linha por produto de seller terceiro, pronta para
        `cert_marketplace_items`. Produtos so do seller da casa ficam de fora.
    """
    site_url = _store_config()["site_url"]
    linhas: list[dict] = []
    for product in products:
        sellers = third_party_sellers(product)
        if not sellers:
            continue
        name = str(product.get("productName") or product.get("name") or "")
        pieces = extract_pieces(product)
        cert_text = extract_inmetro_text(product)
        verdict, reason = classify(name, pieces, cert_text, threshold)
        link = str(product.get("link") or "")
        if not link:
            link_text = str(product.get("linkText") or "")
            link = f"{site_url}/{link_text}/p" if link_text else ""
        elif not link.startswith("http"):
            link = f"{site_url}{link}"
        linhas.append(
            {
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
        )
    return linhas


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
    threshold: int = DEFAULT_PIECES_THRESHOLD,
    persist: bool = True,
) -> dict:
    """Le a categoria na VTEX, classifica e (opcionalmente) grava.

    Returns:
        Dict com `run_id`, `total`, `summary` e `items`.
    """
    run_id = str(uuid.uuid4())
    produtos = fetch_category_products(category_path)
    linhas = audit_products(produtos, threshold)
    if persist:
        persist_audit(linhas, run_id)
    log.info(
        f"Marketplace audit {run_id}: {len(produtos)} produto(s) lido(s), "
        f"{len(linhas)} de seller terceiro"
    )
    return {
        "run_id": run_id,
        "total": len(linhas),
        "scanned": len(produtos),
        "summary": summarize(linhas),
        "items": linhas,
    }
