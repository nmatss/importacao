"""Integrity of read-only licensing ingestion, including ambiguous Linx data."""

from datetime import date

import pytest

from app.db import sqlserver
from app.services import linx_attributes


def _connection(mocker, rows):
    connection = mocker.MagicMock()
    connection.__enter__.return_value = connection
    connection.cursor.return_value.fetchall.return_value = rows
    return connection


@pytest.mark.parametrize(
    "rows",
    [
        [("SKU", "00225", "30/05/2026", 1), ("SKU", "00225", "01/01/1900", 2)],
        [("SKU", "00225", "01/01/1900", 2), ("SKU", "00225", "30/05/2026", 1)],
        [("SKU", "00225", "", 1), ("SKU", "00225", "30/05/2026", 1)],
        [("SKU", "00225", "30/05/2026", 2)],
    ],
)
def test_strict_license_read_rejects_duplicate_or_wrong_item(mocker, rows):
    mocker.patch.object(sqlserver, "_connect", return_value=_connection(mocker, rows))
    with pytest.raises(sqlserver.LinxPropertyCardinalityError):
        sqlserver.fetch_produto_propriedades("puket", ["00224", "00225"], ["SKU"], strict_prop_codes=["00225"])


def test_strict_license_read_does_not_reject_unrelated_certificate_duplicates(mocker):
    connection = _connection(
        mocker,
        [
            ("SKU", "00224", "31/12/2026", 1),
            ("SKU", "00224", "31/12/2027", 2),
            ("SKU", "00225", "30/05/2026", 1),
        ],
    )
    mocker.patch.object(sqlserver, "_connect", return_value=connection)
    result = sqlserver.fetch_produto_propriedades("puket", ["00224", "00225"], ["SKU"], strict_prop_codes=["00225"])
    assert result["SKU"]["00225"] == "30/05/2026"
    assert "ITEM_PROPRIEDADE" in connection.cursor.return_value.execute.call_args.args[0]


def _sync(mocker, properties, attributes, skus=None):
    mocker.patch.object(linx_attributes, "_load_skus_by_brand", return_value={"Puket": skus or ["SKU"]})
    mocker.patch.object(linx_attributes, "fetch_produto_atributos", return_value=attributes)
    fetch = mocker.patch.object(linx_attributes, "fetch_produto_propriedades", return_value=properties)
    context = mocker.MagicMock()
    cursor = mocker.MagicMock()
    cursor.rowcount = 1
    context.__enter__.return_value = (mocker.MagicMock(), cursor)
    mocker.patch.object(linx_attributes, "db", return_value=context)
    return fetch, cursor


def test_invalid_license_preserves_snapshot_including_timestamp(mocker):
    fetch, cursor = _sync(
        mocker,
        {"VALID": {"00225": "30/05/2026"}, "SKU": {"00225": "31/02/2026"}},
        {"VALID": {}, "SKU": {"grife": "PUKET"}},
        skus=["VALID", "SKU"],
    )
    result = linx_attributes.sync_linx_attributes()
    assert result["updated"] == 0
    assert result["errors"]
    cursor.execute.assert_not_called()
    assert fetch.call_args.kwargs == {"strict_prop_codes": ["00225"]}


def test_ambiguous_license_preserves_snapshot_including_timestamp(mocker):
    fetch, cursor = _sync(mocker, {}, {"SKU": {}})
    fetch.side_effect = sqlserver.LinxPropertyCardinalityError("synthetic ambiguity")
    result = linx_attributes.sync_linx_attributes()
    assert result["updated"] == 0
    assert result["errors"]
    cursor.execute.assert_not_called()


@pytest.mark.parametrize("value", [None, "", "01/01/1900", "01/01/1999"])
def test_found_product_can_clear_genuinely_absent_license(mocker, value):
    _, cursor = _sync(mocker, {"SKU": {"00225": value}}, {"SKU": {}})
    result = linx_attributes.sync_linx_attributes()
    assert result["updated"] == 1
    assert result["errors"] == []
    assert cursor.execute.call_args.args[1][1] is None


def test_absent_product_is_not_overwritten_while_found_product_updates(mocker):
    _, cursor = _sync(mocker, {"FOUND": {"00225": "30/05/2026"}}, {"FOUND": {}}, skus=["MISSING", "FOUND"])
    result = linx_attributes.sync_linx_attributes()
    assert result["updated"] == 1
    assert result["errors"]
    assert cursor.execute.call_count == 1
    assert cursor.execute.call_args.args[1][-1] == "FOUND"
    assert cursor.execute.call_args.args[1][1] == date(2026, 5, 30)


def test_attributes_distinguish_found_empty_product_from_orphan_color(mocker):
    connection = _connection(mocker, [])
    connection.cursor.return_value.fetchall.side_effect = [
        [("FOUND", None)],
        [("MISSING", "31/12/2027")],
    ]
    mocker.patch.object(linx_attributes, "_connect", return_value=connection)
    result = linx_attributes.fetch_produto_atributos("puket", ["FOUND", "MISSING"])
    assert "FOUND" in result
    assert result["FOUND"] == {}
    assert "MISSING" not in result
