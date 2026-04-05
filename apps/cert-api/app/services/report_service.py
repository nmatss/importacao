"""Excel report generation via openpyxl."""

import json
from datetime import datetime, timezone
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from app.config import REPORTS_DIR
from app.db.postgres import db
from app.utils.logging import log

# ---------------------------------------------------------------------------
# Style constants
# ---------------------------------------------------------------------------

_HEADER_FONT_CERT = Font(bold=True, color="FFFFFF", size=11)
_HEADER_FILL_CERT = PatternFill(start_color="059669", end_color="059669", fill_type="solid")
_HEADER_FONT_STOCK = Font(bold=True, color="FFFFFF", size=11)
_HEADER_FILL_STOCK = PatternFill(start_color="1E40AF", end_color="1E40AF", fill_type="solid")

_THIN_BORDER = Border(
    left=Side(style="thin", color="D1D5DB"),
    right=Side(style="thin", color="D1D5DB"),
    top=Side(style="thin", color="D1D5DB"),
    bottom=Side(style="thin", color="D1D5DB"),
)

_STATUS_FILLS: dict[str, PatternFill] = {
    "OK": PatternFill(start_color="D1FAE5", end_color="D1FAE5", fill_type="solid"),
    "URL_NOT_FOUND": PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid"),
    "INCONSISTENT": PatternFill(start_color="FEF3C7", end_color="FEF3C7", fill_type="solid"),
    "EXPIRED": PatternFill(start_color="FCE7F3", end_color="FCE7F3", fill_type="solid"),
}
_EXPIRED_FILL = PatternFill(start_color="FCE7F3", end_color="FCE7F3", fill_type="solid")

_STATUS_LABELS: dict[str, str] = {
    "OK": "Conforme",
    "INCONSISTENT": "Inconsistente",
    "URL_NOT_FOUND": "Nao Encontrado",
    "API_ERROR": "Erro de API",
    "NO_EXPECTED": "Sem Certificacao",
    "EXPIRED": "Vencido",
}


def _fetch_stock_map() -> dict[str, dict[str, int]]:
    """Fetch aggregated stock totals from cert_stock grouped by sku and source.

    Returns:
        Dict mapping sku -> {'cd': int, 'ecommerce': int}.
    """
    stock_map: dict[str, dict[str, int]] = {}
    try:
        with db() as (_conn, _cur):
            _cur.execute("""
                SELECT sku, source, SUM(COALESCE(available, quantity, 0)) as qty
                FROM cert_stock GROUP BY sku, source
            """)
            for srow in _cur.fetchall():
                sk = srow["sku"]
                if sk not in stock_map:
                    stock_map[sk] = {"cd": 0, "ecommerce": 0}
                if srow["source"] == "wms_biguacu":
                    stock_map[sk]["cd"] = srow["qty"] or 0
                else:
                    stock_map[sk]["ecommerce"] += srow["qty"] or 0
    except Exception as e:
        log.warning(f"Could not fetch stock data: {e}")
    return stock_map


def _apply_header_row(
    ws: openpyxl.worksheet.worksheet.Worksheet,
    headers: list[str],
    header_font: Font,
    header_fill: PatternFill,
) -> int:
    """Write and style the header row.

    Args:
        ws: Active worksheet.
        headers: List of column header labels.
        header_font: Font to apply to header cells.
        header_fill: Fill to apply to header cells.

    Returns:
        Row index of the header row.
    """
    ws.append(headers)
    header_row = ws.max_row
    for col_idx in range(1, len(headers) + 1):
        cell = ws.cell(row=header_row, column=col_idx)
        cell.font = header_font
        cell.fill = header_fill
        cell.alignment = Alignment(horizontal="center")
        cell.border = _THIN_BORDER
    return header_row


def generate_products_report(rows: list[dict], brand: str = "", status: str = "") -> Path:
    """Generate an Excel report for cert_products data.

    Args:
        rows: List of product dicts from cert_products.
        brand: Optional brand filter label (used only in filename).
        status: Optional status filter label (used only in filename).

    Returns:
        Path to the generated .xlsx file.
    """
    now = datetime.now(timezone.utc)
    stock_map = _fetch_stock_map()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Produtos"

    # Meta rows
    ok_count = sum(1 for r in rows if r.get("last_validation_status") == "OK")
    not_found_count = sum(1 for r in rows if r.get("last_validation_status") in ("MISSING", "URL_NOT_FOUND"))
    inconsistent_count = sum(1 for r in rows if r.get("last_validation_status") == "INCONSISTENT")
    expired_count = sum(1 for r in rows if r.get("is_expired"))

    ws.append(["Relatorio de Produtos - Certificacoes"])
    ws.merge_cells("A1:J1")
    ws["A1"].font = Font(bold=True, size=14, color="059669")
    ws.append([f"Gerado em: {now.strftime('%d/%m/%Y %H:%M')}"])
    ws.append([f"Total: {len(rows)} produtos"])
    ws.append([])
    ws.append([
        f"Conforme: {ok_count} | Nao Encontrado: {not_found_count} "
        f"| Inconsistente: {inconsistent_count} | Vencidos: {expired_count}"
    ])
    ws.append([])

    headers = [
        "SKU", "Nome", "Marca", "Status", "Pontuacao", "Tipo Certificacao",
        "Texto Esperado", "Texto Encontrado", "URL", "Prazo Venda", "Vencido",
        "Estoque CD", "Estoque E-commerce", "Total Estoque",
    ]
    header_row = _apply_header_row(ws, headers, _HEADER_FONT_CERT, _HEADER_FILL_CERT)

    for r in rows:
        status_raw = r.get("last_validation_status") or ""
        is_exp = r.get("is_expired", False)
        if not status_raw and is_exp:
            status_raw = "EXPIRED"
        label = _STATUS_LABELS.get(status_raw, status_raw)
        score = r.get("last_validation_score")
        score_str = f"{score * 100:.0f}%" if score is not None else ""
        sku = r.get("sku", "")
        stock = stock_map.get(sku, {"cd": 0, "ecommerce": 0})
        row_data = [
            sku, r.get("name", ""), r.get("brand", ""), label, score_str,
            r.get("certification_type", ""), r.get("expected_cert_text", ""),
            r.get("actual_cert_text", ""), r.get("last_validation_url", ""),
            r.get("sale_deadline", ""), "Sim" if is_exp else "",
            stock["cd"], stock["ecommerce"], stock["cd"] + stock["ecommerce"],
        ]
        ws.append(row_data)
        row_idx = ws.max_row
        for col_idx in range(1, len(row_data) + 1):
            ws.cell(row=row_idx, column=col_idx).border = _THIN_BORDER
        status_cell = ws.cell(row=row_idx, column=4)
        if is_exp:
            status_cell.fill = _EXPIRED_FILL
        elif status_raw in _STATUS_FILLS:
            status_cell.fill = _STATUS_FILLS[status_raw]

    col_widths = [15, 40, 18, 18, 12, 25, 40, 40, 50, 15, 10, 12, 18, 14]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    ws.auto_filter.ref = f"A{header_row}:N{ws.max_row}"

    filename = f"produtos_certificacoes_{now.strftime('%Y%m%d_%H%M%S')}.xlsx"
    filepath = REPORTS_DIR / filename
    wb.save(str(filepath))
    return filepath


def generate_stock_report(rows: list, brand: str = "") -> Path:
    """Generate a detailed stock Excel report.

    Args:
        rows: Raw rows from cert_stock JOIN cert_products query.
        brand: Optional brand filter label.

    Returns:
        Path to the generated .xlsx file.
    """
    now = datetime.now(timezone.utc)

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Estoque Detalhado"

    ws.append(["Relatório de Estoque Detalhado - CD Biguaçu + E-commerce"])
    ws.merge_cells("A1:L1")
    ws["A1"].font = Font(bold=True, size=14, color="1E40AF")
    ws.append([f"Data: {now.strftime('%d/%m/%Y %H:%M')}"])
    ws.append([f"Total registros: {len(rows)}"])
    ws.append([])

    headers = [
        "SKU", "Nome", "Marca", "Origem", "Localização", "Quantidade",
        "Disponível", "Reserva", "Trânsito", "Situação", "Status Cert", "Prazo Venda",
    ]
    header_row = _apply_header_row(ws, headers, _HEADER_FONT_STOCK, _HEADER_FILL_STOCK)

    source_labels = {
        "wms_biguacu": "CD Biguaçu (WMS)",
        "ecommerce_puket": "E-commerce Puket",
        "ecommerce_imaginarium": "E-commerce Imaginarium",
    }
    wms_fill = PatternFill(start_color="DBEAFE", end_color="DBEAFE", fill_type="solid")
    ecom_fill = PatternFill(start_color="F0FDF4", end_color="F0FDF4", fill_type="solid")

    for row_data in rows:
        source_raw = row_data.get("source", "")
        row_values = [
            row_data.get("sku", ""), row_data.get("name", ""), row_data.get("brand", ""),
            source_labels.get(source_raw, source_raw),
            (row_data.get("warehouse", "") or "").replace("CD ", ""),
            row_data.get("quantity", 0) or 0, row_data.get("available", 0) or 0,
            row_data.get("reserved", 0) or 0, row_data.get("in_transit", 0) or 0,
            row_data.get("situation", ""), row_data.get("last_validation_status", ""),
            row_data.get("sale_deadline", ""),
        ]
        ws.append(row_values)
        row_idx = ws.max_row
        fill = wms_fill if "wms" in source_raw else ecom_fill
        for col_idx in range(1, len(headers) + 1):
            cell = ws.cell(row=row_idx, column=col_idx)
            cell.border = _THIN_BORDER
            cell.fill = fill

    col_widths = [15, 45, 18, 25, 22, 12, 12, 10, 10, 20, 15, 14]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    ws.auto_filter.ref = f"A{header_row}:L{ws.max_row}"

    filename = f"estoque_detalhado_{now.strftime('%Y%m%d_%H%M%S')}.xlsx"
    filepath = REPORTS_DIR / filename
    wb.save(str(filepath))
    return filepath


def generate_validation_report_xlsx(json_filename: str) -> Path:
    """Convert a JSON validation report to Excel format.

    Args:
        json_filename: Filename (basename only) of the .json report in REPORTS_DIR.

    Returns:
        Path to the generated .xlsx file.
    """
    json_path = REPORTS_DIR / json_filename
    report_data = json.loads(json_path.read_text())
    products = report_data.get("products", report_data.get("results", []))
    summary = report_data.get("summary", {})

    stock_map = _fetch_stock_map()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Validação"

    ws.append(["Relatório de Validação de Certificações"])
    ws.merge_cells("A1:H1")
    ws["A1"].font = Font(bold=True, size=14, color="059669")
    ws.append([f"Data: {report_data.get('date', '')}"])
    ws.append([
        f"Total: {summary.get('total', len(products))} | OK: {summary.get('ok', 0)} "
        f"| Ausente: {summary.get('missing', 0)} | Inconsistente: {summary.get('inconsistent', 0)} "
        f"| Não Encontrado: {summary.get('not_found', 0)}"
    ])
    ws.append([])

    headers = [
        "SKU", "Nome", "Marca", "Status", "Pontuacao", "Texto Esperado",
        "Texto Encontrado", "URL", "Erro", "Estoque CD", "Estoque E-commerce", "Total Estoque",
    ]
    header_row = _apply_header_row(ws, headers, _HEADER_FONT_CERT, _HEADER_FILL_CERT)

    for p in products:
        status_raw = p.get("status", "")
        status_label = _STATUS_LABELS.get(status_raw, status_raw)
        score = p.get("score")
        score_str = f"{score * 100:.0f}%" if score is not None else ""
        p_sku = p.get("sku", "")
        stock = stock_map.get(p_sku, {"cd": 0, "ecommerce": 0})
        row = [
            p_sku, p.get("name", ""), p.get("brand", ""), status_label, score_str,
            p.get("expected_cert_text", ""), p.get("actual_cert_text", ""),
            p.get("url", ""), p.get("error", ""),
            stock["cd"], stock["ecommerce"], stock["cd"] + stock["ecommerce"],
        ]
        ws.append(row)
        row_idx = ws.max_row
        for col_idx in range(1, len(row) + 1):
            ws.cell(row=row_idx, column=col_idx).border = _THIN_BORDER
        status_cell = ws.cell(row=row_idx, column=4)
        if status_raw in _STATUS_FILLS:
            status_cell.fill = _STATUS_FILLS[status_raw]

    col_widths = [15, 40, 18, 18, 12, 40, 40, 50, 40, 12, 18, 14]
    for i, w in enumerate(col_widths, 1):
        ws.column_dimensions[openpyxl.utils.get_column_letter(i)].width = w

    ws.auto_filter.ref = f"A{header_row}:L{ws.max_row}"

    excel_filename = json_filename.replace(".json", ".xlsx")
    excel_path = REPORTS_DIR / excel_filename
    wb.save(str(excel_path))
    return excel_path
