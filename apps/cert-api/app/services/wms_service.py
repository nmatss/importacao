"""WMS + ERP stock synchronization service."""

from datetime import datetime, timezone

from app.db.oracle import fetch_wms_stock
from app.db.postgres import db
from app.db.sqlserver import fetch_ecommerce_stock
from app.utils.logging import log


def sync_stock_all() -> dict:
    """Sync stock from WMS Oracle + ERP Puket + ERP Imaginarium into cert_stock.

    Returns:
        Dict with keys: wms, ecommerce_puket, ecommerce_imaginarium, errors.
    """
    results: dict = {"wms": 0, "ecommerce_puket": 0, "ecommerce_imaginarium": 0, "errors": []}
    now = datetime.now(timezone.utc).isoformat()

    # 1. WMS Oracle
    try:
        wms_rows = fetch_wms_stock()
        with db() as (conn, cur):
            cur.execute("DELETE FROM cert_stock WHERE source = 'wms_biguacu'")
            for row in wms_rows:
                sku = str(row.get("CD_PRODUTO", "")).strip()
                if not sku:
                    continue
                area = str(row.get("AREA", "")).strip() or "Geral"
                situation = str(row.get("SITUACAO", "")).strip() or ""
                warehouse_name = f"CD {area}"
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
                        sku, warehouse_name,
                        int(row.get("ESTOQUE", 0) or 0),
                        int(row.get("DISPONIVEL", 0) or 0),
                        int(row.get("RESERVA", 0) or 0),
                        int(row.get("TRANSITO", 0) or 0),
                        situation, area, now,
                    ),
                )
        results["wms"] = len(wms_rows)
    except Exception as e:
        log.warning(f"WMS Oracle sync failed: {e}")
        results["errors"].append(f"WMS Oracle: {e!s}")

    # 2. ERP Puket
    try:
        puket_rows = fetch_ecommerce_stock("puket")
        with db() as (conn, cur):
            for row in puket_rows:
                sku = str(row.get("PRODUTO", row.get("produto", ""))).strip()
                qty = int(row.get("ESTOQUE", row.get("estoque", 0)) or 0)
                if not sku:
                    continue
                cur.execute(
                    """
                    INSERT INTO cert_stock
                        (sku, brand, source, warehouse, quantity, available, synced_at)
                    VALUES (%s, 'puket', 'ecommerce_puket', 'Extrema MG', %s, %s, %s)
                    ON CONFLICT (sku, source, warehouse)
                    DO UPDATE SET quantity=EXCLUDED.quantity, available=EXCLUDED.available,
                        synced_at=EXCLUDED.synced_at
                    """,
                    (sku, qty, qty, now),
                )
        results["ecommerce_puket"] = len(puket_rows)
    except Exception as e:
        log.warning(f"ERP Puket sync failed: {e}")
        results["errors"].append(f"ERP Puket: {e!s}")

    # 3. ERP Imaginarium
    try:
        img_rows = fetch_ecommerce_stock("imaginarium")
        with db() as (conn, cur):
            for row in img_rows:
                sku = str(row.get("PRODUTO", row.get("produto", ""))).strip()
                qty = int(row.get("ESTOQUE", row.get("estoque", 0)) or 0)
                if not sku:
                    continue
                cur.execute(
                    """
                    INSERT INTO cert_stock
                        (sku, brand, source, warehouse, quantity, available, synced_at)
                    VALUES (%s, 'imaginarium', 'ecommerce_imaginarium', 'Extrema MG', %s, %s, %s)
                    ON CONFLICT (sku, source, warehouse)
                    DO UPDATE SET quantity=EXCLUDED.quantity, available=EXCLUDED.available,
                        synced_at=EXCLUDED.synced_at
                    """,
                    (sku, qty, qty, now),
                )
        results["ecommerce_imaginarium"] = len(img_rows)
    except Exception as e:
        log.warning(f"ERP Imaginarium sync failed: {e}")
        results["errors"].append(f"ERP Imaginarium: {e!s}")

    return results
