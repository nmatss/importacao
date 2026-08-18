"""WMS + ERP stock synchronization service."""

import os
from collections import defaultdict
from datetime import UTC, datetime

from app.db.oracle import fetch_wms_stock
from app.db.postgres import db
from app.db.sqlserver import fetch_barcode_map, fetch_ecommerce_stock
from app.utils.logging import log

# Fontes de e-commerce, na ordem em que sao sincronizadas.
_ECOMMERCE_SOURCES = (
    ("puket", "ecommerce_puket", "puket"),
    ("imaginarium", "ecommerce_imaginarium", "imaginarium"),
)

# Queda percentual maxima tolerada entre o snapshot anterior e o novo antes de
# recusar a substituicao.
_DEFAULT_MAX_DROP_PCT = 50.0


class StockSnapshotRejectedError(Exception):
    """Snapshot novo pequeno demais para substituir o que ja esta gravado."""


def _assert_snapshot_plausible(cur, source: str, incoming: int) -> None:
    """Recusa substituir o estoque de uma fonte por um snapshot suspeito.

    O sync e um `DELETE` da fonte seguido do `INSERT` do que veio agora. Uma
    consulta que devolve zero linha SEM levantar excecao — sessao sem
    permissao, filtro que nao casa nada, mapa de barcode que nao traduziu
    nada — apagava o estoque inteiro e deixava todo SKU com 0 no CD. E
    exatamente o sintoma "o item sumiu do WMS", mas na escala da base toda.

    Levantar aqui, dentro do `with db()`, faz o rollback preservar o snapshot
    anterior: estoque velho e ruim, estoque zerado por engano e pior.

    Args:
        cur: cursor aberto na transacao do sync.
        source: valor da coluna `source` em `cert_stock`.
        incoming: quantidade de linhas que o snapshot novo traz.

    Raises:
        StockSnapshotRejectedError: quando a queda excede o limite tolerado.
    """
    if os.getenv("CERT_STOCK_SYNC_FORCE") == "1":
        return

    cur.execute("SELECT COUNT(*) AS n FROM cert_stock WHERE source = %s", (source,))
    row = cur.fetchone() or {}
    previous = int(row.get("n") or 0)

    # Primeira carga da fonte: nao ha nada para proteger.
    if previous == 0:
        return

    if incoming == 0:
        raise StockSnapshotRejectedError(
            f"snapshot vazio para '{source}' enquanto havia {previous} linhas gravadas; "
            "substituicao recusada (use CERT_STOCK_SYNC_FORCE=1 para forcar)"
        )

    try:
        max_drop = float(os.getenv("CERT_STOCK_SYNC_MAX_DROP_PCT", ""))
    except ValueError:
        max_drop = _DEFAULT_MAX_DROP_PCT
    if not 0 < max_drop <= 100:
        max_drop = _DEFAULT_MAX_DROP_PCT

    drop_pct = (previous - incoming) / previous * 100
    if drop_pct > max_drop:
        raise StockSnapshotRejectedError(
            f"snapshot de '{source}' caiu {drop_pct:.1f}% ({previous} -> {incoming}), "
            f"acima do limite de {max_drop:.0f}%; substituicao recusada "
            "(use CERT_STOCK_SYNC_FORCE=1 para forcar)"
        )


def _to_int(value: object) -> int:
    """Converte quantidade do ERP/WMS em int, tolerando None/Decimal/texto."""
    if value is None or value == "":
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _load_barcode_maps() -> dict[str, str]:
    """Monta o mapa EAN -> codigo de produto das duas bases Linx.

    O WMS identifica quase todo item pelo codigo de barras (30.787 dos 35.342
    registros em 2026-08-07), enquanto `cert_products.sku` guarda o codigo de
    produto. Sem este mapa o join por SKU so alcanca a Imaginarium, que usa
    PIxxxxY nos dois lados: a Puket ficava com 2 de 223 produtos com estoque de
    CD e a Puket Escolares com 0 de 162.

    Falha de conexao com uma das bases nao derruba o sync — o codigo cru segue
    para o banco e a ocorrencia vai para o log.

    Returns:
        Dict {codigo_barra -> produto}, unindo as duas marcas.
    """
    mapa: dict[str, str] = {}
    for brand in ("puket", "imaginarium"):
        try:
            parcial = fetch_barcode_map(brand)
            mapa.update(parcial)
            log.info(f"Barcode map {brand}: {len(parcial)} codigos")
        except Exception as e:
            log.warning(f"Barcode map {brand} indisponivel ({e}); SKUs ficam como estao")
    return mapa


def _aggregate_wms(rows: list[dict], barcode_map: dict[str, str]) -> list[dict]:
    """Agrega as linhas do WMS por (sku, area) e traduz EAN -> SKU.

    A query do Oracle agrupa por (CD_PRODUTO, AREA, SITUACAO), mas a chave unica
    de `cert_stock` e (sku, source, warehouse) — sem SITUACAO. O `ON CONFLICT`
    fazia a ultima situacao SOBRESCREVER as anteriores em vez de somar: em
    2026-08-07 eram 360 pares (sku, area) com mais de uma situacao, cujo estoque
    era silenciosamente perdido. Agregar antes de gravar resolve na origem.

    Args:
        rows: linhas cruas de `fetch_wms_stock`.
        barcode_map: {codigo_barra -> produto} para traduzir o codigo do WMS.

    Returns:
        Lista de dicts prontos para o upsert, um por (sku, warehouse).
    """
    agregado: dict[tuple[str, str], dict] = {}
    traduzidos = 0
    for row in rows:
        codigo = str(row.get("CD_PRODUTO", "") or "").strip()
        if not codigo:
            continue
        sku = barcode_map.get(codigo, codigo)
        if sku != codigo:
            traduzidos += 1
        area = str(row.get("AREA", "") or "").strip() or "Geral"
        chave = (sku, f"CD {area}")
        item = agregado.get(chave)
        if item is None:
            item = agregado[chave] = {
                "sku": sku,
                "warehouse": f"CD {area}",
                "storage_area": area,
                "quantity": 0,
                "available": 0,
                "reserved": 0,
                "in_transit": 0,
                "situations": set(),
            }
        item["quantity"] += _to_int(row.get("ESTOQUE"))
        item["available"] += _to_int(row.get("DISPONIVEL"))
        item["reserved"] += _to_int(row.get("RESERVA"))
        item["in_transit"] += _to_int(row.get("TRANSITO"))
        situacao = str(row.get("SITUACAO", "") or "").strip()
        if situacao:
            item["situations"].add(situacao)

    for item in agregado.values():
        item["situation"] = ", ".join(sorted(item.pop("situations")))

    log.info(
        f"WMS: {len(rows)} linhas -> {len(agregado)} registros agregados "
        f"({traduzidos} codigos de barras traduzidos para SKU)"
    )
    return list(agregado.values())


def _aggregate_ecommerce(rows: list[dict]) -> list[dict]:
    """Agrega o estoque de e-commerce por produto, somando as cores.

    `estoque_produtos` tem uma linha por (PRODUTO, COR_PRODUTO) — 10.117 linhas
    para 9.503 produtos na Puket. Como o upsert usa (sku, source, warehouse), as
    cores colidiam e a ULTIMA sobrescrevia as demais: o painel mostrava o estoque
    de uma cor, nao o do produto.

    Args:
        rows: linhas cruas de `fetch_ecommerce_stock`.

    Returns:
        Lista de dicts {sku, quantity}, um por produto.
    """
    agregado: dict[str, int] = defaultdict(int)
    for row in rows:
        sku = str(row.get("PRODUTO", row.get("produto", "")) or "").strip()
        if not sku:
            continue
        agregado[sku] += _to_int(row.get("ESTOQUE", row.get("estoque", 0)))
    return [{"sku": sku, "quantity": qty} for sku, qty in agregado.items()]


def sync_stock_all() -> dict:
    """Sync stock from WMS Oracle + ERP Puket + ERP Imaginarium into cert_stock.

    Cada fonte e substituida por completo (DELETE + INSERT do que veio agora).
    O e-commerce nao era apagado antes do insert, entao um SKU que saia do ERP
    conservava para sempre a ultima quantidade conhecida — com o `synced_at`
    velho junto.

    A substituicao passa por `_assert_snapshot_plausible`: snapshot vazio, ou
    queda acima de `CERT_STOCK_SYNC_MAX_DROP_PCT` (padrao 50%), e recusado e a
    fonte conserva o snapshot anterior. Sem esse gate, uma consulta que
    devolvia zero linha sem excecao zerava o CD de toda a base.

    Returns:
        Dict with keys: wms, ecommerce_puket, ecommerce_imaginarium, errors.
    """
    results: dict = {"wms": 0, "ecommerce_puket": 0, "ecommerce_imaginarium": 0, "errors": []}
    now = datetime.now(UTC).isoformat()

    # 1. WMS Oracle
    try:
        wms_rows = _aggregate_wms(fetch_wms_stock(), _load_barcode_maps())
        with db() as (conn, cur):
            _assert_snapshot_plausible(cur, "wms_biguacu", len(wms_rows))
            cur.execute("DELETE FROM cert_stock WHERE source = 'wms_biguacu'")
            for item in wms_rows:
                cur.execute(
                    """
                    INSERT INTO cert_stock
                        (sku, source, warehouse, quantity, available, reserved,
                         in_transit, situation, storage_area, synced_at)
                    VALUES (%s, 'wms_biguacu', %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (sku, source, warehouse)
                    DO UPDATE SET
                        quantity=EXCLUDED.quantity, available=EXCLUDED.available,
                        reserved=EXCLUDED.reserved, in_transit=EXCLUDED.in_transit,
                        situation=EXCLUDED.situation, storage_area=EXCLUDED.storage_area,
                        synced_at=EXCLUDED.synced_at
                    """,
                    (
                        item["sku"], item["warehouse"], item["quantity"],
                        item["available"], item["reserved"], item["in_transit"],
                        item["situation"], item["storage_area"], now,
                    ),
                )
        results["wms"] = len(wms_rows)
    except StockSnapshotRejectedError as e:
        # Nao e falha de conexao: a fonte respondeu, mas com volume incompativel.
        # O estoque anterior foi preservado pelo rollback e precisa de olho humano.
        log.error(f"WMS Oracle snapshot rejected: {e}")
        results["errors"].append(f"WMS Oracle (snapshot recusado): {e!s}")
    except Exception as e:
        log.warning(f"WMS Oracle sync failed: {e}")
        results["errors"].append(f"WMS Oracle: {e!s}")

    # 2. ERP e-commerce (Puket e Imaginarium)
    for brand, source, stock_brand in _ECOMMERCE_SOURCES:
        try:
            items = _aggregate_ecommerce(fetch_ecommerce_stock(brand))
            with db() as (conn, cur):
                _assert_snapshot_plausible(cur, source, len(items))
                cur.execute("DELETE FROM cert_stock WHERE source = %s", (source,))
                for item in items:
                    cur.execute(
                        """
                        INSERT INTO cert_stock
                            (sku, brand, source, warehouse, quantity, available, synced_at)
                        VALUES (%s, %s, %s, 'Extrema MG', %s, %s, %s)
                        ON CONFLICT (sku, source, warehouse)
                        DO UPDATE SET quantity=EXCLUDED.quantity, available=EXCLUDED.available,
                            synced_at=EXCLUDED.synced_at
                        """,
                        (item["sku"], stock_brand, source, item["quantity"], item["quantity"], now),
                    )
            results[source] = len(items)
        except StockSnapshotRejectedError as e:
            log.error(f"ERP {brand} snapshot rejected: {e}")
            results["errors"].append(f"ERP {brand} (snapshot recusado): {e!s}")
        except Exception as e:
            log.warning(f"ERP {brand} sync failed: {e}")
            results["errors"].append(f"ERP {brand}: {e!s}")

    log.info(f"Stock sync: {results}")
    return results


def summarize_stock_rows(rows: list[dict]) -> dict[str, dict]:
    """Agrega linhas de `cert_stock` em totais por SKU — fonte unica de verdade.

    Painel e relatorio divergiam porque cada um somava de um jeito. O painel
    usava `available or quantity`, e o `or` do Python trata 0 como ausente: uma
    area com tudo reservado (available=0, quantity=18) entrava com 18. O
    relatorio usava `COALESCE(available, quantity)`, que so cai para quantity
    quando available e NULL, e entrava com 0. Resultado medido em PI7223Y
    (2026-08-07): 462 no painel contra 444 no relatorio.

    Aqui vale `available` — "estoque disponivel para venda", que e o numero que o
    time compara com o WMS. `quantity` continua visivel no detalhe por deposito e
    no relatorio de estoque detalhado.

    Args:
        rows: dicts com sku, source, warehouse, quantity, available, synced_at.

    Returns:
        {sku: {stock_cd, stock_ecommerce, stock_total, stock_detail, stock_synced_at}}.
    """
    resumo: dict[str, dict] = {}
    for r in rows:
        sku = r.get("sku")
        if not sku:
            continue
        entry = resumo.get(sku)
        if entry is None:
            entry = resumo[sku] = {
                "stock_cd": 0,
                "stock_ecommerce": 0,
                "stock_total": 0,
                "stock_detail": [],
                "stock_synced_at": None,
            }
        available = _to_int(r.get("available"))
        quantity = _to_int(r.get("quantity"))
        source = r.get("source") or ""
        synced_at = r.get("synced_at")

        entry["stock_detail"].append({
            "source": source,
            "warehouse": r.get("warehouse"),
            "quantity": quantity,
            "available": available,
            "synced_at": synced_at.isoformat() if hasattr(synced_at, "isoformat") else synced_at,
        })
        if source == "wms_biguacu":
            entry["stock_cd"] += available
        else:
            entry["stock_ecommerce"] += available
        entry["stock_total"] = entry["stock_cd"] + entry["stock_ecommerce"]

        if synced_at is not None:
            atual = entry["stock_synced_at"]
            iso = synced_at.isoformat() if hasattr(synced_at, "isoformat") else str(synced_at)
            if atual is None or iso > atual:
                entry["stock_synced_at"] = iso
    return resumo
