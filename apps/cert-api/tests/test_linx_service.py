"""Unit tests for the Linx certificate-write logic (pure logic, no DB/network)."""

from datetime import date

import pytest

from app.db.sqlserver import _brand_linx, _ident
from app.services import linx_service


# --------------------------------------------------------------------------- #
# _ident — SQL identifier guard
# --------------------------------------------------------------------------- #
@pytest.mark.parametrize(
    "good",
    ["PROP_PRODUTOS", "PRODUTO", "VALOR_PROPRIEDADE", "col1", "dbo.PROP_PRODUTOS", "dbo.PRODUTOS"],
)
def test_ident_accepts_safe_identifiers(good):
    assert _ident(good) == good


@pytest.mark.parametrize(
    "bad",
    ["", "a b", "x;DROP", "tbl--", "a)b", "a'b", "a.b.c", ".tbl", "tbl.", "dbo.a;b"],
)
def test_ident_rejects_unsafe(bad):
    with pytest.raises(ValueError):
        _ident(bad)


# --------------------------------------------------------------------------- #
# _brand_linx — brand -> Linx config / property codes
# --------------------------------------------------------------------------- #
def test_brand_imaginarium_codes():
    cfg = _brand_linx("Imaginarium")
    assert cfg["prop_validade_certificado"] == "00106"
    assert cfg["prop_vencimento_licenciamento"] == "00107"


def test_brand_puket_codes():
    cfg = _brand_linx("puket")
    assert cfg["prop_validade_certificado"] == "00224"
    assert cfg["prop_vencimento_licenciamento"] == "00225"


def test_brand_puket_escolares_maps_to_puket_codes():
    # panel uses 'puket_escolares' (underscore); must still resolve to Puket codes
    cfg = _brand_linx("puket_escolares")
    assert cfg["prop_validade_certificado"] == "00224"


def test_brand_unknown_raises():
    with pytest.raises(ValueError):
        _brand_linx("nike")


# --------------------------------------------------------------------------- #
# _format_date
# --------------------------------------------------------------------------- #
def test_format_date_iso_to_brazilian():
    assert linx_service._format_date("2026-12-31") == "31/12/2026"


def test_format_date_from_date_object():
    assert linx_service._format_date(date(2026, 1, 5)) == "05/01/2026"


def test_format_date_empty():
    assert linx_service._format_date("") == ""
    assert linx_service._format_date(None) == ""


def test_format_date_already_brazilian_passthrough():
    assert linx_service._format_date("31/12/2026") == "31/12/2026"


# --------------------------------------------------------------------------- #
# write_certificate_to_linx — fail-closed + branching
# --------------------------------------------------------------------------- #
def test_write_disabled_when_flag_off(monkeypatch):
    monkeypatch.setattr(linx_service, "LINX_WRITE_ENABLED", False)
    out = linx_service.write_certificate_to_linx("imaginarium", "123", "2026-12-31", None)
    assert out["status"] == "disabled"
    assert "LINX_WRITE_ENABLED" in out["error"]
    assert out["produto_codigo"] is None


def test_write_error_on_unknown_brand_when_enabled(monkeypatch):
    monkeypatch.setattr(linx_service, "LINX_WRITE_ENABLED", True)
    out = linx_service.write_certificate_to_linx("nike", "123", "2026-12-31", None)
    assert out["status"] == "error"
    assert "Linx" in out["error"]


def test_write_applied_upserts_both_props(monkeypatch):
    monkeypatch.setattr(linx_service, "LINX_WRITE_ENABLED", True)
    monkeypatch.setattr(linx_service, "resolve_produto_codigo", lambda brand, sku: "P-999")
    calls = []

    def fake_upsert(brand, produto, prop_code, valor):
        calls.append((brand, produto, prop_code, valor))
        return "updated"

    monkeypatch.setattr(linx_service, "upsert_produto_propriedade", fake_upsert)

    out = linx_service.write_certificate_to_linx(
        "imaginarium", "SKU1", "2026-12-31", "2027-06-30"
    )
    assert out["status"] == "applied"
    assert out["produto_codigo"] == "P-999"
    # both properties written with formatted dates and correct codes
    assert ("imaginarium", "P-999", "00106", "31/12/2026") in calls
    assert ("imaginarium", "P-999", "00107", "30/06/2027") in calls


def test_write_skips_missing_date(monkeypatch):
    monkeypatch.setattr(linx_service, "LINX_WRITE_ENABLED", True)
    monkeypatch.setattr(linx_service, "resolve_produto_codigo", lambda brand, sku: "P-1")
    calls = []
    monkeypatch.setattr(
        linx_service,
        "upsert_produto_propriedade",
        lambda b, p, c, v: calls.append(c) or "inserted",
    )
    out = linx_service.write_certificate_to_linx("puket", "SKU", "2026-12-31", None)
    assert out["status"] == "applied"
    assert calls == ["00224"]  # only validade written; vencimento skipped


def test_resolve_raises_when_sku_mapping_unconfigured():
    # Default config (sku_is_produto=false, produto_col_sku="") must fail closed,
    # not return the raw SKU.
    from app.db import sqlserver

    with pytest.raises(ValueError, match="nao configurada"):
        sqlserver.resolve_produto_codigo("imaginarium", "SKU-COR-TAM")


def test_write_error_when_resolution_unconfigured(monkeypatch):
    # End-to-end: enabled + unconfigured resolution => error, nothing written.
    monkeypatch.setattr(linx_service, "LINX_WRITE_ENABLED", True)
    out = linx_service.write_certificate_to_linx("imaginarium", "SKU-1", "2026-12-31", None)
    assert out["status"] == "error"
    assert "resolver" in out["error"].lower() or "configurada" in out["error"].lower()


def test_write_error_when_sku_unresolved(monkeypatch):
    monkeypatch.setattr(linx_service, "LINX_WRITE_ENABLED", True)
    monkeypatch.setattr(linx_service, "resolve_produto_codigo", lambda brand, sku: None)
    out = linx_service.write_certificate_to_linx("puket", "SKU", "2026-12-31", None)
    assert out["status"] == "error"
    assert "nao encontrado" in out["error"]
