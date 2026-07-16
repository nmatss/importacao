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


# --------------------------------------------------------------------------- #
# upsert_produto_propriedade — INSERT/UPDATE/unchanged contra o schema real
#
# Schema confirmado nas duas bases em 2026-07-16:
#   PROP_PRODUTOS PK = (PROPRIEDADE, PRODUTO, ITEM_PROPRIEDADE)
#   ITEM_PROPRIEDADE smallint NOT NULL, sem default  -> INSERT precisa informa-la
# --------------------------------------------------------------------------- #


class _FakeCursor:
    """Cursor que grava o SQL executado e devolve o valor atual configurado."""

    def __init__(self, current_value):
        self._current = current_value
        self.executed: list[tuple[str, tuple]] = []

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params or ()))

    def fetchone(self):
        # Só o SELECT inicial lê; devolve None para "propriedade ausente".
        return None if self._current is None else (self._current,)


class _FakeConn:
    def __init__(self, current_value):
        self.cursor_obj = _FakeCursor(current_value)
        self.committed = False
        self.rolled_back = False
        self.closed = False

    def cursor(self):
        return self.cursor_obj

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def _fake_linx(monkeypatch, current_value):
    """Aponta o _connect para uma conexão falsa com o valor atual dado."""
    from app.db import sqlserver

    conn = _FakeConn(current_value)
    monkeypatch.setattr(sqlserver, "_connect", lambda cfg: conn)
    return conn, sqlserver


def test_upsert_inserts_with_item_propriedade_when_absent(monkeypatch):
    # O bug que isso trava: sem ITEM_PROPRIEDADE o INSERT viola NOT NULL/PK e todo
    # produto que ainda nao tem a propriedade falha — o caminho do 1o cadastro.
    conn, sqlserver = _fake_linx(monkeypatch, current_value=None)

    action = sqlserver.upsert_produto_propriedade("puket", "070400034", "00224", "24/04/2027")

    assert action == "inserted"
    insert_sql, params = conn.cursor_obj.executed[-1]
    assert insert_sql.startswith("INSERT INTO PROP_PRODUTOS")
    assert "ITEM_PROPRIEDADE" in insert_sql
    assert params == ("070400034", "00224", 1, "24/04/2027")
    assert conn.committed and not conn.rolled_back


def test_upsert_updates_when_value_changed(monkeypatch):
    conn, sqlserver = _fake_linx(monkeypatch, current_value="31/05/2025")

    action = sqlserver.upsert_produto_propriedade("puket", "070400034", "00224", "24/04/2027")

    assert action == "updated"
    update_sql, params = conn.cursor_obj.executed[-1]
    assert update_sql.startswith("UPDATE PROP_PRODUTOS SET VALOR_PROPRIEDADE")
    assert params == ("24/04/2027", "070400034", "00224")
    assert conn.committed


def test_upsert_is_noop_when_value_already_matches(monkeypatch):
    # PROP_PRODUTOS tem trigger ativo no Puket (LXU_PROP_PRODUTOS): reescrever o
    # mesmo valor dispararia a replicacao do Linx a toa.
    conn, sqlserver = _fake_linx(monkeypatch, current_value="24/04/2027")

    action = sqlserver.upsert_produto_propriedade("puket", "070400034", "00224", "24/04/2027")

    assert action == "unchanged"
    assert len(conn.cursor_obj.executed) == 1  # só o SELECT
    assert not any(s.startswith(("UPDATE", "INSERT")) for s, _ in conn.cursor_obj.executed)


def test_upsert_ignores_padding_when_comparing(monkeypatch):
    # VALOR_PROPRIEDADE é texto com padding — sem trim, todo write pareceria mudança.
    conn, sqlserver = _fake_linx(monkeypatch, current_value="24/04/2027    ")

    assert sqlserver.upsert_produto_propriedade("puket", "P1", "00224", "24/04/2027") == "unchanged"


def test_upsert_treats_null_value_as_change(monkeypatch):
    conn, sqlserver = _fake_linx(monkeypatch, current_value=None)
    # row existe mas VALOR_PROPRIEDADE é NULL -> fetchone devolve (None,)
    monkeypatch.setattr(conn.cursor_obj, "fetchone", lambda: (None,))

    assert sqlserver.upsert_produto_propriedade("puket", "P1", "00224", "24/04/2027") == "updated"


def test_upsert_selects_under_lock_before_deciding(monkeypatch):
    # UPDLOCK+HOLDLOCK serializa o caso "linha ausente": dois upserts simultaneos
    # nao podem os dois cair no INSERT.
    conn, sqlserver = _fake_linx(monkeypatch, current_value=None)
    sqlserver.upsert_produto_propriedade("puket", "P1", "00224", "01/01/2027")
    first_sql, _ = conn.cursor_obj.executed[0]
    assert first_sql.startswith("SELECT VALOR_PROPRIEDADE FROM PROP_PRODUTOS WITH (UPDLOCK, HOLDLOCK)")


def test_upsert_rolls_back_and_closes_on_failure(monkeypatch):
    from app.db import sqlserver

    conn = _FakeConn(None)

    def boom(sql, params=None):
        raise RuntimeError("SQL Server caiu")

    monkeypatch.setattr(conn.cursor_obj, "execute", boom)
    monkeypatch.setattr(sqlserver, "_connect", lambda cfg: conn)

    with pytest.raises(RuntimeError):
        sqlserver.upsert_produto_propriedade("puket", "P1", "00224", "01/01/2027")
    assert conn.rolled_back and conn.closed and not conn.committed


# --------------------------------------------------------------------------- #
# Credenciais por marca — db01 (Puket) e db02 (Imaginarium) sao instancias
# separadas, com logins separados. Uma credencial unica nao atende as duas.
# --------------------------------------------------------------------------- #


def _brands_with_env(**env) -> dict:
    """LINX_BRANDS resultante do env dado (as constantes são lidas no import).

    Copia o resultado e recarrega o módulo no estado original, para o config
    remendado não vazar para os outros testes.
    """
    import importlib
    import os
    from copy import deepcopy

    from app import config as config_mod

    keys = (
        "ERP_MSSQL_USER", "ERP_MSSQL_PASS",
        "ERP_PUKET_USER", "ERP_PUKET_PASS", "ERP_IMG_USER", "ERP_IMG_PASS",
    )
    saved = {k: os.environ.get(k) for k in keys}
    try:
        for k in keys:
            os.environ.pop(k, None)
        os.environ.update(env)
        brands = deepcopy(importlib.reload(config_mod).LINX_BRANDS)
    finally:
        for k in keys:
            os.environ.pop(k, None)
            if saved[k] is not None:
                os.environ[k] = saved[k]
        importlib.reload(config_mod)
    return brands


def test_each_brand_uses_its_own_credentials():
    # O bug: db01 e db02 têm senhas DIFERENTES; com uma credencial só, ligar uma
    # marca derrubava a outra.
    brands = _brands_with_env(
        ERP_PUKET_USER="u_puket", ERP_PUKET_PASS="p_puket",
        ERP_IMG_USER="u_img", ERP_IMG_PASS="p_img",
    )
    assert (brands["puket"]["user"], brands["puket"]["password"]) == ("u_puket", "p_puket")
    assert (brands["imaginarium"]["user"], brands["imaginarium"]["password"]) == ("u_img", "p_img")
    # puket escolares roda no mesmo db01 do puket.
    assert brands["puket escolares"]["password"] == "p_puket"


def test_shared_credential_still_serves_both_brands():
    # Retrocompatível: quem tem um login só para as duas bases segue funcionando.
    brands = _brands_with_env(ERP_MSSQL_USER="shared", ERP_MSSQL_PASS="pw")
    assert brands["puket"]["password"] == "pw"
    assert brands["imaginarium"]["password"] == "pw"


def test_brand_specific_credential_wins_over_the_shared_one():
    brands = _brands_with_env(
        ERP_MSSQL_USER="shared", ERP_MSSQL_PASS="pw",
        ERP_IMG_USER="u_img", ERP_IMG_PASS="p_img",
    )
    assert brands["imaginarium"]["password"] == "p_img"
    assert brands["puket"]["password"] == "pw"  # sem especifica -> fallback


def test_connect_uses_the_brand_credentials(monkeypatch):
    import pymssql

    from app.db import sqlserver

    captured = {}

    def fake_connect(host, user, password, db, **kw):
        captured.update(host=host, user=user, password=password, db=db)
        return _FakeConn(None)

    monkeypatch.setattr(pymssql, "connect", fake_connect)
    sqlserver._connect(
        {"host": "db01", "db": "DB_puket", "user": "u_puket", "password": "p_puket"}
    )
    assert captured == {"host": "db01", "user": "u_puket", "password": "p_puket", "db": "DB_puket"}
