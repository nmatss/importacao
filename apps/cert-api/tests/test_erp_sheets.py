"""Leitura das abas da planilha STATUS CERTIFICACAO.

Cabecalhos e valores reproduzidos da planilha real (conferidos em 2026-08-07).
"""

from app.services.erp_service import (
    _ATIVOS_SHEETS,
    _canonical_brand,
    _find_col_by_header,
    _looks_like_ean,
    _read_ativos_from_sheets,
    _read_encerramentos_from_sheets,
    _resolve_columns,
    normalize_brand_filter,
)

# Cabecalho A..W das abas "Imaginarium" / "Puket".
MARCA_HEADERS = [
    "MARCA", "IMAGEM", "CÓDIGO", "COLEÇÃO", "Fornecedor", "NOME", "NEGÓCIO",
    "TIPO DE CERTIFICAÇÃO", "AMOSTRAS NECESSÁRIAS", "STATUS",
    "DATA ÚLTIMA ATUALIZAÇÃO (INICIAL, MANUTENÇÃO OU ENCERRAMENTO)", "ROTULAGEM",
    "FABRICANTE", "Validade da Certificação", "Início Manutenção",
    "Número Certificado", "Número Registro / Homologação", "OCP / OCD",
    "Possui ISO 9001?", "CHEGADA CD", "SITUAÇÃO", "Descrição E-commerce",
    "Prazo Final Venda",
]

ESCOLARES_HEADERS = [
    "SKU", "NOME COMERCIAL (CERTIFICADO)", "TIPO", "CERTIFICADO", "REGISTRO",
    "INCLUSÃO", "STATUS", "Descrição E-commerce", "Coleção", "Prazo Final Venda",
    "NOME COMERCIAL TAG",
]

ENCERRAMENTOS_HEADERS = [
    "CERTIFICADO", "SKU", "NOME", "ESTOQUE INFORMADO ENCERRAMENTO",
    "DATA NOTIFICAÇÃO", "DATA LEMBRETE", "PRAZO FINAL VENDA", "STATUS",
    "CÓDIGO DE BARRAS", "MARCA", "CUSTO MÉDIO ENTRADA", "REF CONCATENADA",
]


class _FakeWorksheet:
    def __init__(self, rows):
        self._rows = rows

    def get_all_values(self):
        return self._rows


class _FakeSpreadsheet:
    def __init__(self, tabs):
        self._tabs = tabs

    def worksheet(self, name):
        if name not in self._tabs:
            raise KeyError(name)
        return _FakeWorksheet(self._tabs[name])


class TestFindColByHeader:
    def test_match_exato_vence_substring(self):
        """Na aba 'Puket escolares', 'certificado' casava com 'NOME COMERCIAL
        (CERTIFICADO)' (B) antes da coluna 'CERTIFICADO' (D)."""
        assert _find_col_by_header(ESCOLARES_HEADERS, "certificado") == 3

    def test_substring_ainda_funciona_como_fallback(self):
        assert _find_col_by_header(MARCA_HEADERS, "prazo final venda") == 22
        assert _find_col_by_header(MARCA_HEADERS, "descrição e-commerce") == 21

    def test_nao_encontrado(self):
        assert _find_col_by_header(MARCA_HEADERS, "inexistente") is None


class TestResolveColumns:
    def test_layout_das_abas_de_marca(self):
        cfg = next(c for c in _ATIVOS_SHEETS if c["name"] == "Imaginarium")
        cols = _resolve_columns(MARCA_HEADERS, cfg["fields"], "Imaginarium")
        assert cols["sku"] == 2                    # C
        assert cols["name"] == 5                   # F
        assert cols["certification_type"] == 7     # H
        assert cols["sheet_status"] == 9           # J
        assert cols["numero_certificado"] == 15    # P
        assert cols["situacao"] == 20              # U
        assert cols["ecommerce_description"] == 21  # V

    def test_layout_puket_escolares(self):
        cfg = next(c for c in _ATIVOS_SHEETS if c["name"] == "Puket escolares")
        cols = _resolve_columns(ESCOLARES_HEADERS, cfg["fields"], "Puket escolares")
        assert cols["sku"] == 0
        assert cols["numero_certificado"] == 3
        assert cols["sheet_status"] == 6
        assert cols["ecommerce_description"] == 7

    def test_coluna_deslocada_e_seguida_pelo_cabecalho(self):
        deslocado = ["EXTRA", *MARCA_HEADERS]
        cfg = next(c for c in _ATIVOS_SHEETS if c["name"] == "Puket")
        cols = _resolve_columns(deslocado, cfg["fields"], "Puket")
        assert cols["numero_certificado"] == 16    # P virou Q


class TestReadAtivos:
    def _linha(self, marca, codigo):
        row = [""] * 23
        row[0], row[2], row[4], row[5] = marca, codigo, "Kayuan", "FONE DE OUVIDO UNICORNIO"
        row[7] = "ANATEL CATEGORIA 2 - MÓDULO BLUETOOTH"
        row[9] = "04/05/2026 - ESSSA CERTIFICAÇÃO NÃO SERÁ CONTINUADA"
        row[15], row[20], row[21] = "MODERNA-1659/23", "Ativo", "Homologado pela Anatel: 13911-23-11617"
        return row

    def test_marca_vem_da_aba_nao_da_coluna_a(self):
        """A coluna MARCA trazia 'Kayuan' (o FORNECEDOR) no item 100400496, o que
        derrubava a resolucao da loja VTEX e o marcava como Nao conforme."""
        ss = _FakeSpreadsheet({"Puket": [MARCA_HEADERS, self._linha("Kayuan", "100400496")]})
        produtos = _read_ativos_from_sheets(ss)
        assert len(produtos) == 1
        assert produtos[0]["brand"] == "Puket"
        assert produtos[0]["sku"] == "100400496"

    def test_le_numero_certificado_e_situacao(self):
        ss = _FakeSpreadsheet({"Puket": [MARCA_HEADERS, self._linha("PUKET", "100400496")]})
        p = _read_ativos_from_sheets(ss)[0]
        assert p["numero_certificado"] == "MODERNA-1659/23"
        assert p["situacao"] == "Ativo"
        assert p["certification_type"] == "ANATEL CATEGORIA 2 - MÓDULO BLUETOOTH"
        assert p["ecommerce_description"].startswith("Homologado pela Anatel")

    def test_celula_com_varios_skus(self):
        linha = self._linha("PUKET", "100400496\n100400497")
        ss = _FakeSpreadsheet({"Puket": [MARCA_HEADERS, linha]})
        assert {p["sku"] for p in _read_ativos_from_sheets(ss)} == {"100400496", "100400497"}

    def test_aba_ausente_nao_derruba_o_sync(self):
        ss = _FakeSpreadsheet({"Puket": [MARCA_HEADERS, self._linha("PUKET", "X1")]})
        assert len(_read_ativos_from_sheets(ss)) == 1  # Imaginarium/Escolares faltando


class TestReadEncerramentos:
    def _linha(self, sku, prazo, status, marca="IMAGINARIUM", cert="12224/2025-AE-2"):
        row = [""] * 12
        row[0], row[1], row[2] = cert, sku, "PRODUTO"
        row[6], row[7], row[9] = prazo, status, marca
        return row

    def _ler(self, linhas, mocker=None):
        ss = _FakeSpreadsheet({"Encerramentos": [ENCERRAMENTOS_HEADERS, *linhas]})
        return _read_encerramentos_from_sheets(ss)

    def test_linha_sem_prazo_mas_com_status_e_lida(self):
        """28 linhas so tem a coluna H; a leitura antiga exigia data e as
        descartava — PI7560Y ficava sem prazo nenhum no painel."""
        out = self._ler([self._linha("PI7560Y", "", "Comerciação Permitida")])
        assert len(out) == 1
        assert out[0]["encerramento_status"] == "Comerciação Permitida"
        assert out[0]["sale_deadline"] == ""
        assert out[0]["is_expired"] is False

    def test_venda_bloqueada_marca_vencido(self):
        out = self._ler([self._linha("PI7223Y", "24/07/2026", "Vencido - Venda Bloqueada")])
        assert out[0]["is_expired"] is True
        assert out[0]["sale_deadline_date"] == "2026-07-24"

    def test_venda_permitida_com_data_futura_nao_vence(self):
        out = self._ler([self._linha("PI7999Y", "31/12/2030", "Comerciação Permitida")])
        assert out[0]["is_expired"] is False

    def test_linha_sem_prazo_e_sem_status_e_ignorada(self):
        assert self._ler([self._linha("PI0000Y", "", "")]) == []

    def test_marca_normalizada(self):
        out = self._ler([self._linha("PI7560Y", "", "Comerciação Permitida", marca="IMAGINARIUM")])
        assert out[0]["brand"] == "Imaginarium"

    def test_numero_certificado_vem_da_coluna_a(self):
        out = self._ler([self._linha("PI7560Y", "", "Comerciação Permitida")])
        assert out[0]["numero_certificado"] == "12224/2025-AE-2"


class TestEanESku:
    def test_reconhece_ean(self):
        assert _looks_like_ean("7909692117610") is True
        assert _looks_like_ean("100400496") is False   # SKU Puket tem 9 digitos
        assert _looks_like_ean("PI7560Y") is False

    def test_resolve_ean_para_sku(self, mocker):
        mocker.patch(
            "app.db.sqlserver.fetch_barcode_map",
            return_value={"7909692117610": "100400416"},
        )
        ss = _FakeSpreadsheet({
            "Encerramentos": [
                ENCERRAMENTOS_HEADERS,
                ["cert", "7909692117610", "FONE", "", "", "", "13/08/2023",
                 "Vencido - Venda Bloqueada", "7909692117610", "PUKET", "", ""],
            ]
        })
        out = _read_encerramentos_from_sheets(ss)
        assert out[0]["sku"] == "100400416"
        assert out[0]["sku_origem_ean"] == "7909692117610"

    def test_falha_do_linx_mantem_o_codigo_cru(self, mocker):
        mocker.patch("app.db.sqlserver.fetch_barcode_map", side_effect=OSError("db01 offline"))
        ss = _FakeSpreadsheet({
            "Encerramentos": [
                ENCERRAMENTOS_HEADERS,
                ["cert", "7909692117610", "FONE", "", "", "", "13/08/2023",
                 "Vencido - Venda Bloqueada", "", "PUKET", "", ""],
            ]
        })
        out = _read_encerramentos_from_sheets(ss)
        assert out[0]["sku"] == "7909692117610"


class TestMarcas:
    def test_canonical(self):
        assert _canonical_brand("IMAGINARIUM") == "Imaginarium"
        assert _canonical_brand("puket_escolares") == "Puket Escolares"
        assert _canonical_brand("Kayuan", default="Puket") == "Puket"

    def test_filtro_slug_do_frontend(self):
        """O painel manda `puket_escolares` e o banco guarda `Puket Escolares`."""
        assert normalize_brand_filter("puket_escolares") == "puket escolares"
        assert normalize_brand_filter("Imaginarium") == "imaginarium"


class TestSyncSheetsToDb:
    """A limpeza de prazos nao pode confundir "aba vazia" com "falha de leitura"."""

    def _mock_db(self, mocker):
        cur = mocker.MagicMock()
        cur.rowcount = 7
        ctx = mocker.MagicMock()
        ctx.__enter__ = mocker.MagicMock(return_value=(mocker.MagicMock(), cur))
        ctx.__exit__ = mocker.MagicMock(return_value=False)
        mocker.patch("app.services.erp_service.db", return_value=ctx)
        # `sync_sheets_to_db` importa DATABASE_URL de app.config em tempo de chamada.
        mocker.patch("app.config.DATABASE_URL", "postgres://test")
        mocker.patch("app.services.erp_service.SHEETS_SPREADSHEET_ID", "sheet-id")
        mocker.patch("app.services.erp_service._get_sheets_client", return_value=mocker.MagicMock())
        return cur

    def test_encerramentos_vazio_nao_dispara_limpeza(self, mocker):
        """Sheets fora do ar devolve [] — apagar prazo de todo mundo seria perda de dado."""
        from app.services import erp_service

        cur = self._mock_db(mocker)
        mocker.patch.object(
            erp_service, "_read_ativos_from_sheets",
            return_value=[{"sku": "PI1Y", "name": "N", "brand": "Imaginarium",
                           "certification_type": "T", "numero_certificado": "C",
                           "situacao": "Ativo", "sheet_status": "S",
                           "ecommerce_description": "D"}],
        )
        mocker.patch.object(erp_service, "_read_encerramentos_from_sheets", return_value=[])

        result = erp_service.sync_sheets_to_db()

        assert result["encerramentos_limpos"] == 0
        sqls = [c.args[0] for c in cur.execute.call_args_list]
        assert not any("SET sale_deadline = NULL" in s for s in sqls)

    def test_encerramentos_lido_dispara_limpeza(self, mocker):
        from app.services import erp_service

        cur = self._mock_db(mocker)
        mocker.patch.object(erp_service, "_read_ativos_from_sheets", return_value=[])
        mocker.patch.object(
            erp_service, "_read_encerramentos_from_sheets",
            return_value=[{"sku": "PI7223Y", "name": "N", "brand": "Imaginarium",
                            "numero_certificado": "C", "sale_deadline": "24/07/2026",
                            "sale_deadline_date": "2026-07-24",
                            "encerramento_status": "Vencido - Venda Bloqueada",
                            "is_expired": True}],
        )

        result = erp_service.sync_sheets_to_db()

        assert result["encerramentos_limpos"] == 7
        sqls = [c.args[0] for c in cur.execute.call_args_list]
        assert any("SET sale_deadline = NULL" in s for s in sqls)

    def test_limpa_residuos_do_sync_antigo(self, mocker):
        """SKU so-de-encerramento carregava 'ENCERRAMENTO - Prazo:' e marca em caixa alta."""
        from app.services import erp_service

        cur = self._mock_db(mocker)
        mocker.patch.object(erp_service, "_read_ativos_from_sheets", return_value=[])
        mocker.patch.object(
            erp_service, "_read_encerramentos_from_sheets",
            return_value=[{"sku": "050402301", "name": "N", "brand": "Puket",
                            "numero_certificado": "C", "sale_deadline": "07/12/2025",
                            "sale_deadline_date": "2025-12-07",
                            "encerramento_status": "Vencido - Venda Bloqueada",
                            "is_expired": True}],
        )

        erp_service.sync_sheets_to_db()
        sqls = [c.args[0] for c in cur.execute.call_args_list]

        assert any("ENCERRAMENTO - Prazo%" in s and "certification_type = CASE" in s for s in sqls)
        assert any("SET brand = %s" in s for s in sqls)

    def test_remove_orfao_de_ean_apenas_do_que_foi_resolvido(self, mocker):
        from app.services import erp_service

        cur = self._mock_db(mocker)
        mocker.patch.object(erp_service, "_read_ativos_from_sheets", return_value=[])
        mocker.patch.object(
            erp_service, "_read_encerramentos_from_sheets",
            return_value=[{"sku": "100400416", "sku_origem_ean": "7909692117610",
                            "name": "N", "brand": "Puket", "numero_certificado": "C",
                            "sale_deadline": "13/08/2023", "sale_deadline_date": "2023-08-13",
                            "encerramento_status": "Vencido - Venda Bloqueada",
                            "is_expired": True}],
        )

        erp_service.sync_sheets_to_db()
        delete = next(
            c for c in cur.execute.call_args_list if "DELETE FROM cert_products" in c.args[0]
        )
        assert delete.args[1][0] == ["7909692117610"]
        assert delete.args[1][1] == ["100400416"]

    def test_sem_ean_resolvido_nao_emite_delete(self, mocker):
        from app.services import erp_service

        cur = self._mock_db(mocker)
        mocker.patch.object(erp_service, "_read_ativos_from_sheets", return_value=[])
        mocker.patch.object(
            erp_service, "_read_encerramentos_from_sheets",
            return_value=[{"sku": "PI7223Y", "name": "N", "brand": "Imaginarium",
                            "numero_certificado": "C", "sale_deadline": "24/07/2026",
                            "sale_deadline_date": "2026-07-24",
                            "encerramento_status": "Vencido - Venda Bloqueada",
                            "is_expired": True}],
        )

        erp_service.sync_sheets_to_db()
        assert not any(
            "DELETE FROM cert_products" in c.args[0] for c in cur.execute.call_args_list
        )
