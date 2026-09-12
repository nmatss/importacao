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
    resolver_encerramentos,
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
    "SKU", "NOME COMERCIAL (CERTIFICADO)", "TIPO", "TIPO DE CERTIFICAÇÃO",
    "CERTIFICADO", "REGISTRO", "INCLUSÃO", "STATUS", "Descrição E-commerce",
    "Coleção", "Prazo Final Venda", "NOME COMERCIAL TAG",
]

# Cabecalho REAL da aba "Encerramentos" em 11/09/2026: ganhou 'DATA LEMBRETE -
# TRANSF. ESTOQUE' em G (o prazo foi para H, o status para I) e 'Dupla
# certificação?' em N. A leitura e por cabecalho, entao a posicao nao importa —
# e e exatamente isso que estes testes provam.
ENCERRAMENTOS_HEADERS = [
    "CERTIFICADO", "SKU", "NOME", "ESTOQUE INFORMADO", "DATA NOTIFICAÇÃO",
    "DATA LEMBRETE- FIM VENDA", "DATA LEMBRETE - TRANSF. ESTOQUE",
    "PRAZO FINAL VENDA", "STATUS", "CÓDIGO DE BARRAS", "MARCA", "CUSTO",
    "REF CONCATENADA", "Dupla certificação?",
]
I_CERT, I_SKU, I_NOME = 0, 1, 2
I_LEMBRETE_VENDA, I_LEMBRETE_ESTOQUE = 5, 6
I_PRAZO, I_STATUS, I_BARRAS, I_MARCA = 7, 8, 9, 10


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
        (CERTIFICADO)' (B) antes da coluna exata 'CERTIFICADO' (E)."""
        assert _find_col_by_header(ESCOLARES_HEADERS, "certificado") == 4

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

    def test_aba_puket_escolares_nao_e_mais_lida(self):
        """Guarda estatica da decisao de 11/09: a aba foi ABANDONADA.

        Enquanto ela era lida — e por ultimo — gravava brand='Puket Escolares' e
        situacao='' por cima do U='Ativo' da aba Puket em 167 SKUs.
        """
        nomes = {c["name"].strip().lower() for c in _ATIVOS_SHEETS}
        assert "puket escolares" not in nomes
        assert nomes == {"imaginarium", "puket"}

    def test_validade_da_certificacao_resolvida_por_cabecalho(self):
        cfg = next(c for c in _ATIVOS_SHEETS if c["name"] == "Puket")
        cols = _resolve_columns(MARCA_HEADERS, cfg["fields"], "Puket")
        assert cols["validade_certificado"] == 13  # N

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

    def test_aba_escolares_presente_na_planilha_e_ignorada(self):
        """O SKU escolar ja esta na aba Puket; a aba velha nao pode sobrescrever.

        Cenario real: 100400496 nas DUAS abas. A escolar nao tem coluna U, e como
        vinha por ultimo zerava a situacao do item.
        """
        escolar = [""] * len(ESCOLARES_HEADERS)
        escolar[0], escolar[1], escolar[7] = "100400496", "ESTOJO ESCOLAR", "ATIVO"
        ss = _FakeSpreadsheet({
            "Puket": [MARCA_HEADERS, self._linha("PUKET", "100400496")],
            "Puket escolares": [ESCOLARES_HEADERS, escolar],
        })

        produtos = _read_ativos_from_sheets(ss)

        assert len(produtos) == 1
        assert produtos[0]["brand"] == "Puket"
        assert produtos[0]["situacao"] == "Ativo"

    def test_le_a_validade_da_certificacao(self):
        linha = self._linha("PUKET", "100400496")
        linha[13] = "08/11/2024"
        ss = _FakeSpreadsheet({"Puket": [MARCA_HEADERS, linha]})

        p = _read_ativos_from_sheets(ss)[0]

        assert p["validade_certificado"] == "2024-11-08"
        assert p["validade_certificado_raw"] == "08/11/2024"

    def test_validade_sentinela_nao_vira_data(self):
        linha = self._linha("PUKET", "100400497")
        linha[13] = "01/01/1900"
        ss = _FakeSpreadsheet({"Puket": [MARCA_HEADERS, linha]})

        p = _read_ativos_from_sheets(ss)[0]

        assert p["validade_certificado"] is None
        assert p["validade_certificado_raw"] == "01/01/1900"

    def test_dupla_certificacao_a_linha_ativa_vence(self):
        """PI6552Y (PELUCIA NEVINHO G): encerrado 8325/2022 + ativo 10473/2024."""
        antiga = self._linha("IMAGINARIUM", "PI6552Y")
        antiga[15], antiga[20] = "8325/2022-BRI-1", "Encerrado"
        nova = self._linha("IMAGINARIUM", "PI6552Y")
        nova[15], nova[20] = "10473/2024-BRI-1", "Ativo"

        for ordem in ([antiga, nova], [nova, antiga]):
            ss = _FakeSpreadsheet({"Imaginarium": [MARCA_HEADERS, *ordem]})
            produtos = _read_ativos_from_sheets(ss)
            assert len(produtos) == 1, "o SKU nao pode entrar duas vezes"
            assert produtos[0]["situacao"] == "Ativo"
            assert produtos[0]["numero_certificado"] == "10473/2024-BRI-1"

    def test_aba_ausente_nao_derruba_o_sync(self):
        ss = _FakeSpreadsheet({"Puket": [MARCA_HEADERS, self._linha("PUKET", "X1")]})
        assert len(_read_ativos_from_sheets(ss)) == 1  # Imaginarium/Escolares faltando


class TestReadEncerramentos:
    def _linha(self, sku, prazo, status, marca="IMAGINARIUM", cert="12224/2025-AE-2"):
        row = [""] * len(ENCERRAMENTOS_HEADERS)
        row[I_CERT], row[I_SKU], row[I_NOME] = cert, sku, "PRODUTO"
        row[I_PRAZO], row[I_STATUS], row[I_MARCA] = prazo, status, marca
        return row

    def _ler(self, linhas, mocker=None):
        ss = _FakeSpreadsheet({"Encerramentos": [ENCERRAMENTOS_HEADERS, *linhas]})
        return _read_encerramentos_from_sheets(ss)

    def test_prazo_vem_do_cabecalho_e_nunca_de_um_lembrete(self):
        """Caso PI5914Y: G=29/09/2026 (lembrete) e H=29/10/2026 (prazo real).

        A coluna nova de lembrete de transferencia de estoque entrou ANTES do
        prazo; ler por letra fixa devolveria a data errada.
        """
        linha = self._linha("PI5914Y", "29/10/2026", "Comerciação Permitida")
        linha[I_LEMBRETE_VENDA] = "29/09/2026"
        linha[I_LEMBRETE_ESTOQUE] = "15/09/2026"

        out = self._ler([linha])

        assert out[0]["sale_deadline"] == "29/10/2026"
        assert out[0]["sale_deadline_date"] == "2026-10-29"
        assert out[0]["encerramento_status"] == "Comerciação Permitida"

    def test_coluna_extra_antes_do_prazo_nao_desloca_a_leitura(self):
        """Prova de independencia de posicao: mais uma coluna no meio."""
        headers = [
            *ENCERRAMENTOS_HEADERS[:I_PRAZO], "COLUNA NOVA", *ENCERRAMENTOS_HEADERS[I_PRAZO:]
        ]
        linha = self._linha("PI5914Y", "29/10/2026", "Vencido - Venda Bloqueada")
        linha.insert(I_PRAZO, "lixo")
        ss = _FakeSpreadsheet({"Encerramentos": [headers, linha]})

        out = _read_encerramentos_from_sheets(ss)

        assert out[0]["sale_deadline"] == "29/10/2026"
        assert out[0]["encerramento_status"] == "Vencido - Venda Bloqueada"
        assert out[0]["is_expired"] is True

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


class TestResolverEncerramentos:
    """Encerramento de certificado ANTIGO nao trava SKU com certificado ativo."""

    def _ativo(self, sku, situacao, cert):
        return {"sku": sku, "situacao": situacao, "numero_certificado": cert}

    def _enc(self, sku, prazo, cert, status="Comerciação Permitida"):
        return {
            "sku": sku,
            "sale_deadline": prazo,
            "sale_deadline_date": None,
            "numero_certificado": cert,
            "encerramento_status": status,
            "is_expired": False,
        }

    def test_sku_ativo_nao_recebe_prazo_do_certificado_velho(self):
        """PI6552Y: ativo por 10473/2024, encerramento do 8325/2022 e historico."""
        aplicaveis, historicos = resolver_encerramentos(
            [self._ativo("PI6552Y", "Ativo", "10473/2024-BRI-1")],
            [self._enc("PI6552Y", "29/10/2026", "8325/2022-BRI-1")],
        )
        assert aplicaveis == []
        assert len(historicos) == 1

    def test_sku_ativo_com_encerramento_bloqueado_de_outro_certificado(self):
        """PI5968Y aparecia ENCERRADO por um 'Vencido - Venda Bloqueada' antigo."""
        aplicaveis, _ = resolver_encerramentos(
            [self._ativo("PI5968Y", "Ativo", "9142/2023-BRI-2")],
            [self._enc("PI5968Y", "29/10/2026", "8325/2022-BRI-1", "Vencido - Venda Bloqueada")],
        )
        assert aplicaveis == []

    def test_sku_encerrado_continua_recebendo_o_prazo(self):
        aplicaveis, historicos = resolver_encerramentos(
            [self._ativo("PI5914Y", "Encerrado", "8325/2022-BRI-1")],
            [self._enc("PI5914Y", "29/10/2026", "8325/2022-BRI-1")],
        )
        assert [a["sku"] for a in aplicaveis] == ["PI5914Y"]
        assert historicos == []

    def test_sku_sem_linha_de_produto_continua_recebendo_o_prazo(self):
        """108 SKUs Puket so existem na aba Encerramentos."""
        aplicaveis, _ = resolver_encerramentos([], [self._enc("050402301", "07/12/2025", "X")])
        assert len(aplicaveis) == 1

    def test_entre_dois_encerramentos_prefere_o_do_certificado_vigente(self):
        aplicaveis, historicos = resolver_encerramentos(
            [self._ativo("PI6073Y", "Encerrado", "9142/2023-BRI-2")],
            [
                self._enc("PI6073Y", "29/10/2026", "8325/2022-BRI-1"),
                self._enc("PI6073Y", "26/01/2025", "9142/2023-BRI-2"),
            ],
        )
        assert aplicaveis[0]["sale_deadline"] == "26/01/2025"
        assert len(historicos) == 1

    def test_ordem_das_linhas_nao_decide(self):
        linhas = [
            self._enc("PI6073Y", "26/01/2025", "9142/2023-BRI-2"),
            self._enc("PI6073Y", "29/10/2026", "8325/2022-BRI-1"),
        ]
        aplicaveis, _ = resolver_encerramentos(
            [self._ativo("PI6073Y", "Encerrado", "9142/2023-BRI-2")], linhas
        )
        assert aplicaveis[0]["sale_deadline"] == "26/01/2025"


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

    def test_encerramento_de_sku_ativo_nao_e_gravado(self, mocker):
        """PI6552Y: o prazo do certificado velho nao pode entrar no banco."""
        from app.services import erp_service

        cur = self._mock_db(mocker)
        mocker.patch.object(
            erp_service, "_read_ativos_from_sheets",
            return_value=[{"sku": "PI6552Y", "name": "PELUCIA NEVINHO G",
                           "brand": "Imaginarium", "certification_type": "INMETRO",
                           "numero_certificado": "10473/2024-BRI-1", "situacao": "Ativo",
                           "sheet_status": "S", "ecommerce_description": "D",
                           "validade_certificado": None, "validade_certificado_raw": ""}],
        )
        mocker.patch.object(
            erp_service, "_read_encerramentos_from_sheets",
            return_value=[{"sku": "PI6552Y", "name": "N", "brand": "Imaginarium",
                            "numero_certificado": "8325/2022-BRI-1",
                            "sale_deadline": "29/10/2026",
                            "sale_deadline_date": "2026-10-29",
                            "encerramento_status": "Comerciação Permitida",
                            "is_expired": False}],
        )

        result = erp_service.sync_sheets_to_db()

        assert result["synced"] == 0
        assert "Dupla certificacao" in result["error"]
        cur.execute.assert_not_called()

    def test_grava_a_validade_do_certificado(self, mocker):
        from app.services import erp_service

        cur = self._mock_db(mocker)
        mocker.patch.object(
            erp_service, "_read_ativos_from_sheets",
            return_value=[{"sku": "PI5555Y", "name": "VITROLA", "brand": "Imaginarium",
                           "certification_type": "INMETRO", "numero_certificado": "C",
                           "situacao": "Ativo", "sheet_status": "S",
                           "ecommerce_description": "D",
                           "validade_certificado": "2027-03-22",
                           "validade_certificado_raw": "22/03/2027"}],
        )
        mocker.patch.object(erp_service, "_read_encerramentos_from_sheets", return_value=[])

        erp_service.sync_sheets_to_db()

        upsert = next(
            c for c in cur.execute.call_args_list if "validade_certificado" in c.args[0]
        )
        assert "2027-03-22" in upsert.args[1]
        assert "22/03/2027" in upsert.args[1]

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
