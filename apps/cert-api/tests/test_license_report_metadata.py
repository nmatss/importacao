from datetime import UTC, datetime

from app.services.report_service import _licenciamento_meta_line


def test_snapshot_metadata_uses_oldest_read_and_reports_missing_rows():
    text = _licenciamento_meta_line(
        [
            {"linx_synced_at": datetime(2026, 9, 18, 15, tzinfo=UTC)},
            {"linx_synced_at": "2026-09-17T15:00:00+00:00"},
            {"linx_synced_at": None},
        ]
    )
    assert "Linx (somente leitura)" in text
    assert "17/09/2026 12:00 (Sao Paulo)" in text
    assert "1 produto(s) sem data de leitura" in text


def test_absent_or_invalid_snapshot_dates_do_not_claim_freshness():
    assert "data da leitura nao informada" in _licenciamento_meta_line([{"linx_synced_at": "bad"}])
    assert "nenhum produto no filtro" in _licenciamento_meta_line([])
