"""Synthetic SQL Server doubles: not SQL Server integration evidence."""

from unittest.mock import MagicMock

import pytest

from app.db import sqlserver
from app.services import linx_service


def _connections(monkeypatch, before, after):
    writer, reader = MagicMock(), MagicMock()
    writer.cursor.return_value.fetchall.return_value = before
    reader.cursor.return_value.fetchall.return_value = after
    connect = MagicMock(side_effect=[writer, reader])
    monkeypatch.setattr(sqlserver, "_connect", connect)
    return writer, reader, connect


@pytest.mark.parametrize("rows", [[(1, "old"), (2, "other")], [(2, "old")]])
def test_unexpected_cardinality_or_item_blocks_before_mutation(monkeypatch, rows):
    writer, _reader, connect = _connections(monkeypatch, rows, [])
    with pytest.raises(sqlserver.LinxPropertyCardinalityError):
        sqlserver.upsert_produto_propriedade("puket", "SYNTHETIC", "00224", "01/01/2027")
    assert writer.cursor.return_value.execute.call_count == 1
    writer.commit.assert_not_called()
    writer.rollback.assert_called_once()
    writer.close.assert_called_once()
    assert connect.call_count == 1


@pytest.mark.parametrize(
    "before,action", [([], "inserted"), ([(1, "01/01/2020")], "updated"), ([(1, "01/01/2027")], "unchanged")]
)
def test_success_requires_new_connection_and_full_primary_key_readback(monkeypatch, before, action):
    writer, reader, connect = _connections(monkeypatch, before, [(1, "01/01/2027   ")])

    def read_after_commit(sql, params):
        writer.commit.assert_called_once()
        writer.close.assert_called_once()
        assert "AND ITEM_PROPRIEDADE = %s" in sql
        assert params == ("SYNTHETIC", "00224", 1)

    reader.cursor.return_value.execute.side_effect = read_after_commit
    assert sqlserver.upsert_produto_propriedade("puket", "SYNTHETIC", "00224", "01/01/2027") == action
    assert connect.call_count == 2
    writer.rollback.assert_not_called()
    reader.close.assert_called_once()
    reader.commit.assert_not_called()


@pytest.mark.parametrize(
    "after", [[], [(1, "02/01/2027")], [(2, "01/01/2027")], [(1, "01/01/2027"), (1, "01/01/2027")]]
)
def test_postcommit_mismatch_requires_reconciliation_without_rollback_or_retry(monkeypatch, after):
    writer, reader, connect = _connections(monkeypatch, [(1, "01/01/2020")], after)
    with pytest.raises(sqlserver.LinxReconciliationRequiredError, match="reconciliar"):
        sqlserver.upsert_produto_propriedade("puket", "SYNTHETIC", "00224", "01/01/2027")
    assert writer.cursor.return_value.execute.call_count == 2
    assert reader.cursor.return_value.execute.call_count == 1
    writer.commit.assert_called_once()
    writer.rollback.assert_not_called()
    assert connect.call_count == 2


@pytest.mark.parametrize("failure", ["commit", "connect", "read"])
def test_uncertain_commit_or_verification_never_claims_rollback(monkeypatch, failure):
    writer, reader, connect = _connections(monkeypatch, [], [(1, "01/01/2027")])
    confidential_error = RuntimeError("synthetic private driver details")
    if failure == "commit":
        writer.commit.side_effect = confidential_error
    elif failure == "connect":
        connect.side_effect = [writer, confidential_error]
    else:
        reader.cursor.return_value.execute.side_effect = confidential_error
    with pytest.raises(sqlserver.LinxReconciliationRequiredError, match="reconciliar") as exc:
        sqlserver.upsert_produto_propriedade("puket", "SYNTHETIC", "00224", "01/01/2027")
    assert "private" not in str(exc.value)
    writer.rollback.assert_not_called()
    assert writer.cursor.return_value.execute.call_count == 2
    assert connect.call_count == (1 if failure == "commit" else 2)


@pytest.mark.parametrize(
    "error,expected",
    [
        (sqlserver.LinxReconciliationRequiredError("private driver details"), "reconciliar"),
        (sqlserver.LinxPropertyCardinalityError("private driver details"), "escrita bloqueada"),
    ],
)
def test_service_surfaces_sanitized_actionable_error(monkeypatch, error, expected):
    monkeypatch.setattr(linx_service, "LINX_WRITE_ENABLED", True)
    monkeypatch.setattr(linx_service, "resolve_produto_codigo", lambda *args: "SYNTHETIC")
    upsert = MagicMock(side_effect=error)
    monkeypatch.setattr(linx_service, "upsert_produto_propriedade", upsert)
    result = linx_service.write_certificate_to_linx(
        "puket",
        "SYNTHETIC",
        None,
        None,
        fim_venda="2027-01-01",
        situacao="ENCERRADO",
    )
    assert result["status"] == "error"
    assert expected in result["error"]
    assert "private" not in result["error"]
    assert result["details"] == []
    upsert.assert_called_once()
