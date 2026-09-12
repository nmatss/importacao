"""Leitura em lote de atributos do Linx para o painel (CFN-01 / decisao D11)."""

from datetime import date

import pytest

from app.services import linx_attributes


def _db_ctx(mocker, cursor):
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(mocker.MagicMock(), cursor))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    return ctx


@pytest.mark.parametrize(
    ("valor", "esperado"),
    [
        ("31/12/2027", date(2027, 12, 31)),
        ("2027-12-31", date(2027, 12, 31)),
        # A sentinela do Linx para "sem data". Devolve-la como data real pintava
        # o produto como licenciamento VENCIDO em 1900.
        ("01/01/1900", None),
        ("01/01/1999", None),
        ("", None),
        (None, None),
        ("Comercializacao Permitida", None),
        (date(2026, 10, 29), date(2026, 10, 29)),
    ],
)
def test_parse_linx_date(valor, esperado):
    assert linx_attributes.parse_linx_date(valor) == esperado


def test_grife_column_is_img_licenciamento_only_for_imaginarium():
    """Na Imaginarium GRIFFE guarda a marca da casa, nao o licenciador."""
    assert linx_attributes.grife_column_for("Imaginarium") == "IMG_LICENCIAMENTO"
    assert linx_attributes.grife_column_for("puket") == "GRIFFE"
    assert linx_attributes.grife_column_for("Puket_Escolares") == "GRIFFE"
    assert linx_attributes.grife_column_for("marca nova") == "GRIFFE"


def test_fetch_produto_atributos_keeps_the_earliest_real_fim_vendas(mocker):
    """A trava vale por cor; o produto carrega a PRIMEIRA a vencer.

    A sentinela 01/01/1900 de uma cor nao pode virar a menor data — seria uma
    trava no passado para um produto liberado.
    """
    cur = mocker.MagicMock()
    cur.fetchall.side_effect = [
        [("PI5555Y", "MARVEL  ")],
        [
            ("PI5555Y", "01/01/1900"),
            ("PI5555Y", "20/11/2027"),
            ("PI5555Y", "22/03/2027"),
        ],
    ]
    conn = mocker.MagicMock()
    conn.cursor.return_value = cur
    conn.__enter__ = mocker.MagicMock(return_value=conn)
    conn.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch.object(linx_attributes, "_connect", return_value=conn)
    mocker.patch.object(linx_attributes, "_brand_linx", return_value={"db": "db01"})

    out = linx_attributes.fetch_produto_atributos("puket", ["PI5555Y"])

    assert out == {"PI5555Y": {"grife": "MARVEL", "fim_vendas": date(2027, 3, 22)}}


def test_fetch_produto_atributos_short_circuits_on_empty_input(mocker):
    connect = mocker.patch.object(linx_attributes, "_connect")
    assert linx_attributes.fetch_produto_atributos("puket", []) == {}
    connect.assert_not_called()


def test_sync_writes_only_the_linx_columns(mocker):
    """O sync NAO pode tocar em nada que venha da planilha."""
    mocker.patch.object(
        linx_attributes, "_load_skus_by_brand", return_value={"Imaginarium": ["PI5555Y"]}
    )
    mocker.patch.object(
        linx_attributes,
        "_brand_linx",
        return_value={"prop_validade_certificado": "00106", "prop_vencimento_licenciamento": "00107"},
    )
    mocker.patch.object(
        linx_attributes,
        "fetch_produto_propriedades",
        return_value={"PI5555Y": {"00106": "22/03/2027", "00107": "01/01/1900"}},
    )
    mocker.patch.object(
        linx_attributes,
        "fetch_produto_atributos",
        return_value={"PI5555Y": {"grife": "HARRY POTTER", "fim_vendas": date(2027, 3, 22)}},
    )
    cur = mocker.MagicMock()
    cur.rowcount = 1
    mocker.patch.object(linx_attributes, "db", return_value=_db_ctx(mocker, cur))

    result = linx_attributes.sync_linx_attributes()

    assert result["updated"] == 1
    sql, params = cur.execute.call_args.args
    flat = " ".join(str(sql).split())
    assert flat.startswith("UPDATE cert_products SET grife")
    for coluna in ("numero_certificado", "sale_deadline", "situacao", "sheet_status"):
        assert coluna not in flat
    # 00107 = 01/01/1900 -> sem licenciamento, e nao "vencido em 1900".
    assert params[1] is None
    assert params[2] == date(2027, 3, 22)
    assert params[0] == "HARRY POTTER"


def test_sync_skips_the_brand_when_linx_is_unavailable(mocker):
    """Linx fora do ar nao vira 'sem licenca': a marca inteira fica intocada."""
    mocker.patch.object(
        linx_attributes, "_load_skus_by_brand", return_value={"Puket": ["PI1"]}
    )
    mocker.patch.object(
        linx_attributes,
        "_brand_linx",
        return_value={"prop_validade_certificado": "00224", "prop_vencimento_licenciamento": "00225"},
    )
    mocker.patch.object(
        linx_attributes,
        "fetch_produto_propriedades",
        side_effect=OSError("Login failed for private-user@private-host"),
    )
    cur = mocker.MagicMock()
    mocker.patch.object(linx_attributes, "db", return_value=_db_ctx(mocker, cur))

    result = linx_attributes.sync_linx_attributes()

    assert result["updated"] == 0
    assert result["errors"] == [{"brand": "Puket", "error": "OSError"}]
    # Nenhum UPDATE: linx_synced_at continua o antigo, e o painel consegue
    # distinguir "nunca sincronizado" de "sincronizado e sem licenciamento".
    cur.execute.assert_not_called()
    assert "private-host" not in str(result)


def test_sync_reports_brands_without_linx_mapping(mocker):
    mocker.patch.object(
        linx_attributes, "_load_skus_by_brand", return_value={"Marca Nova": ["X1"]}
    )
    mocker.patch.object(linx_attributes, "_brand_linx", side_effect=ValueError("sem Linx"))
    cur = mocker.MagicMock()
    mocker.patch.object(linx_attributes, "db", return_value=_db_ctx(mocker, cur))

    result = linx_attributes.sync_linx_attributes()

    assert result["errors"] == [{"brand": "Marca Nova", "error": "marca sem Linx configurado"}]
