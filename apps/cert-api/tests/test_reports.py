"""Report route and XLSX generation tests."""

from datetime import UTC, date, datetime

import openpyxl
import pytest

from app.services.report_service import (
    generate_products_report,
    generate_stock_report,
    generate_validation_report_xlsx,
)


def _patch_reports_db(mocker, rows=None):
    cursor = mocker.MagicMock()
    cursor.fetchall.return_value = rows or []
    conn = mocker.MagicMock()
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(conn, cursor))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    mocker.patch("app.routes.reports.db", return_value=ctx)
    return cursor


@pytest.mark.asyncio
async def test_export_stock_normalizes_brand_and_keeps_wms_join(test_client, api_key_headers, mocker, tmp_path):
    """Stock export should filter by product brand alias, not raw cert_stock.brand."""
    mocker.patch("app.routes.reports.DATABASE_URL", "postgres://test")
    cursor = _patch_reports_db(mocker, rows=[{"sku": "PI4257Y", "source": "wms_biguacu"}])
    output = tmp_path / "estoque.xlsx"
    output.write_bytes(b"PK\x03\x04xlsx")
    mocker.patch("app.routes.reports.generate_stock_report", return_value=output)

    resp = await test_client.post(
        "/api/reports/export-stock?brand=puket_escolares",
        headers=api_key_headers,
    )

    assert resp.status_code == 200
    sql, params = cursor.execute.call_args.args
    assert "COALESCE(cp.brand, cs.brand" in sql
    assert params == ["puket escolares"]


@pytest.mark.asyncio
async def test_export_stock_permission_error_is_actionable(test_client, api_key_headers, mocker):
    """Permission errors on cert-reports should return a clear operational message."""
    mocker.patch("app.routes.reports.DATABASE_URL", "postgres://test")
    _patch_reports_db(mocker)
    mocker.patch("app.routes.reports.generate_stock_report", side_effect=PermissionError())

    resp = await test_client.post("/api/reports/export-stock", headers=api_key_headers)

    assert resp.status_code == 500
    assert "cert-reports" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_reports_list_includes_format(test_client, api_key_headers, mocker, tmp_path):
    """The frontend uses format to hide JSON-only actions for generated XLSX files."""
    mocker.patch("app.routes.reports.REPORTS_DIR", tmp_path)
    (tmp_path / "validation.json").write_text("{}", encoding="utf-8")
    (tmp_path / "estoque.xlsx").write_bytes(b"PK\x03\x04xlsx")

    resp = await test_client.get("/api/reports", headers=api_key_headers)

    assert resp.status_code == 200
    formats = {item["filename"]: item["format"] for item in resp.json()}
    assert formats["validation.json"] == "json"
    assert formats["estoque.xlsx"] == "xlsx"


@pytest.mark.asyncio
async def test_report_data_rejects_xlsx(test_client, api_key_headers, mocker, tmp_path):
    """XLSX files are binary and should not be parsed through the JSON detail endpoint."""
    mocker.patch("app.routes.reports.REPORTS_DIR", tmp_path)
    (tmp_path / "estoque.xlsx").write_bytes(b"PK\x03\x04xlsx")

    resp = await test_client.get("/api/reports/estoque.xlsx/data", headers=api_key_headers)

    assert resp.status_code == 400
    assert "JSON" in resp.json()["detail"]


def test_generate_stock_report_writes_synced_at_column(mocker, tmp_path):
    """Generated stock XLSX should include the sync timestamp for WMS auditability."""
    mocker.patch("app.services.report_service.REPORTS_DIR", tmp_path)
    output = generate_stock_report(
        [
            {
                "sku": "PI4257Y",
                "name": "Produto",
                "brand": "Puket",
                "source": "wms_biguacu",
                "warehouse": "CD Picking",
                "quantity": 10,
                "available": 8,
                "reserved": 1,
                "in_transit": 2,
                "situation": "LIBERADO",
                "last_validation_status": "OK",
                "sale_deadline": "2026-12-31",
                "synced_at": datetime(2026, 6, 19, 12, 0, tzinfo=UTC),
            }
        ]
    )

    wb = openpyxl.load_workbook(output)
    ws = wb["Estoque Detalhado"]
    headers = [cell.value for cell in ws[5]]
    assert "Sincronizado em" in headers
    assert ws["M6"].value.startswith("2026-06-19T12:00:00")


def _patch_products_report_io(mocker, tmp_path, stock=None, travas=None):
    """Isola a geracao do XLSX de produtos das consultas ao banco."""
    mocker.patch("app.services.report_service.REPORTS_DIR", tmp_path)
    mocker.patch("app.services.report_service._fetch_stock_map", return_value=stock or {})
    mocker.patch("app.services.report_service._fetch_travas_faturamento", return_value=travas or {})


def _header_index(ws, label: str) -> int:
    """Indice 1-based da coluna cujo cabecalho (linha 7) e `label`."""
    headers = [c.value for c in ws[7]]
    return headers.index(label) + 1


def test_validation_xlsx_separates_certification_type_from_expected_description(
    mocker, tmp_path
):
    """O Excel mostra o tipo e a descricao realmente comparada em colunas distintas."""
    mocker.patch("app.services.report_service.REPORTS_DIR", tmp_path)
    mocker.patch("app.services.report_service._fetch_stock_map", return_value={})
    source = tmp_path / "validation_layout.json"
    source.write_text(
        """{
          "summary": {"total": 1, "ok": 1},
          "products": [{
            "sku": "ESC001",
            "name": "ESTOJO ESCOLAR",
            "brand": "Puket Escolares",
            "status": "OK",
            "score": 1.0,
            "certification_type": "INMETRO SISTEMA 5",
            "expected_cert_text": "Produto certificado conforme Portaria 423."
          }]
        }""",
        encoding="utf-8",
    )

    output = generate_validation_report_xlsx(source.name)
    ws = openpyxl.load_workbook(output)["Validação"]
    headers = [cell.value for cell in ws[5]]

    assert ws.cell(row=6, column=headers.index("Tipo Certificacao") + 1).value == "INMETRO SISTEMA 5"
    assert (
        ws.cell(row=6, column=headers.index("Texto Esperado") + 1).value
        == "Produto certificado conforme Portaria 423."
    )


def test_generated_xlsx_neutralizes_formula_like_text(mocker, tmp_path):
    """User-controlled text exported to XLSX must not execute as formulas."""
    _patch_products_report_io(mocker, tmp_path)

    output = generate_products_report(
        [
            {
                "sku": "=2+2",
                "name": "+Produto",
                "brand": "@Marca",
                "last_validation_status": "OK",
                "certification_type": "-Tipo",
                "numero_certificado": "=Cert",
                "expected_cert_text": "=Esperado",
                "actual_cert_text": "+Encontrado",
                "last_validation_url": "@https://example.invalid",
                "sale_deadline": "-2026-12-31",
                "encerramento_status": "@Comerciacao Permitida",
            }
        ]
    )

    wb = openpyxl.load_workbook(output, data_only=False)
    ws = wb["Produtos"]

    def cell(label: str):
        return ws.cell(row=8, column=_header_index(ws, label)).value

    assert cell("SKU") == "'=2+2"
    assert cell("Nome") == "'+Produto"
    assert cell("Marca") == "'@Marca"
    assert cell("Tipo Certificacao") == "'-Tipo"
    assert cell("Numero Certificado") == "'=Cert"
    assert cell("Texto Esperado") == "'=Esperado"
    assert cell("Texto Encontrado") == "'+Encontrado"
    assert cell("URL") == "'@https://example.invalid"
    assert cell("Fim de Venda (cert)") == "'-2026-12-31"
    assert cell("Situacao da Venda") == "'@Comerciacao Permitida"


@pytest.mark.parametrize("closure_certificate, expected_sale", [
    ("CERT-CURRENT", "Bloqueada"), ("INTERNAL-OLD", "Liberada"),
])
def test_products_report_uses_internal_provenance_without_changing_columns(
    mocker, tmp_path, closure_certificate, expected_sale,
):
    _patch_products_report_io(mocker, tmp_path)
    product = {
        "sku": "SYNTHETIC-PROVENANCE", "brand": "Puket", "situacao": "ATIVO",
        "numero_certificado": "CERT-CURRENT", "sale_deadline_date": date(2026, 1, 1),
        "is_expired": True, "last_validation_status": "OK", "licenciamento_aplicavel": False,
    }
    baseline = openpyxl.load_workbook(generate_products_report([product], today=date(2026, 9, 18)))
    baseline_headers = [cell.value for cell in baseline["Produtos"][7]]
    baseline.close()

    product["encerramento_numero_certificado"] = closure_certificate
    workbook = openpyxl.load_workbook(generate_products_report([product], today=date(2026, 9, 18)))
    sheet = workbook["Produtos"]

    assert [cell.value for cell in sheet[7]] == baseline_headers
    assert sheet.max_column == 29
    assert sheet.cell(8, _header_index(sheet, "Status Certificacao")).value == "Ativo"
    assert sheet.cell(8, _header_index(sheet, "Status de Venda")).value == expected_sale
    assert sheet.cell(8, _header_index(sheet, "Numero Certificado")).value == "CERT-CURRENT"
    assert all(
        cell.value not in ("encerramento_numero_certificado", "INTERNAL-OLD")
        for row in sheet for cell in row
    )
    workbook.close()


def test_products_report_mirrors_panel_status_columns(mocker, tmp_path):
    """O Excel tem de trazer os MESMOS tres status do painel, nao o status cru."""
    _patch_products_report_io(
        mocker,
        tmp_path,
        stock={"PI7560Y": {"stock_cd": 10, "stock_ecommerce": 5, "stock_total": 15,
                           "stock_synced_at": "2026-08-07T09:00:00"}},
    )

    output = generate_products_report(
        [
            {
                "sku": "PI7560Y",
                "name": "CANETA PANDA AMIGOS",
                "brand": "Imaginarium",
                "sheet_status": "27/10/25 - Item excluído e incluído novamente com o novo nome.",
                "encerramento_status": "Comerciação Permitida",
                "last_validation_status": "OK",
                # Licenciamento vem do Linx (D11), nao mais da aba descontinuada.
                "linx_fim_licenciamento": "2026-01-31",
            }
        ],
    )

    wb = openpyxl.load_workbook(output)
    ws = wb["Produtos"]

    def cell(label: str):
        return ws.cell(row=8, column=_header_index(ws, label)).value

    assert cell("Status Certificacao") == "Encerrado"
    # T3 (18/09/2026): licenca vencida (31/01/2026) + produto no site = nao conforme,
    # como a docstring de derive_site_status ja prometia. Antes afirmava "Conforme".
    assert cell("Status E-commerce") == "Nao conforme"
    assert cell("Status Licenciamento") == "Vencido"
    assert cell("Fim Licenciamento (Linx)") == "31/01/2026"
    assert cell("Estoque CD Disponivel") == 10
    assert cell("Total Estoque") == 15
    assert cell("Estoque Atualizado Em") == "2026-08-07T09:00:00"


@pytest.mark.parametrize(
    ("row_extra", "codigo", "rotulo"),
    [
        ({"linx_fim_licenciamento": "2999-12-31"}, "VALIDO", "Valido"),
        ({"linx_fim_licenciamento": "2026-01-31"}, "VENCIDO", "Vencido"),
        ({"licenciamento_aplicavel": False}, "NAO_APLICAVEL", "Nao aplicavel"),
        # Sem data no Linx e sem aplicabilidade confirmada: a derivacao devolve
        # PENDENTE. O mapa nao tinha essa chave e a celula saia com o codigo cru.
        ({}, "PENDENTE", "Pendente de validacao"),
    ],
)
def test_products_report_translates_every_license_status(mocker, tmp_path, row_extra, codigo, rotulo):
    """'Status Licenciamento' sai com rotulo em portugues, nunca com o codigo."""
    from app.services.derivation import compute_status_dimensions

    row = {"sku": "PI7560Y", "name": "CANETA PANDA", "brand": "Imaginarium", **row_extra}
    # Prova que o cenario exercita mesmo o codigo esperado na derivacao real.
    assert compute_status_dimensions(dict(row))["license_status"] == codigo

    _patch_products_report_io(mocker, tmp_path)
    output = generate_products_report([row])

    ws = openpyxl.load_workbook(output)["Produtos"]
    valor = ws.cell(row=8, column=_header_index(ws, "Status Licenciamento")).value
    assert valor == rotulo
    assert valor != codigo


def test_products_report_has_no_vencido_column_and_reports_travas(mocker, tmp_path):
    """A coluna 'Vencido' saiu; entrou o bloco de trava da decisao D11."""
    _patch_products_report_io(
        mocker,
        tmp_path,
        travas={"PI7223Y": {"cert": "24/07/2026", "lic": None, "indisponivel": None}},
    )

    output = generate_products_report([{"sku": "PI7223Y", "name": "CAIXA DE SOM", "brand": "Imaginarium"}])

    wb = openpyxl.load_workbook(output)
    ws = wb["Produtos"]
    headers = [c.value for c in ws[7]]

    assert "Vencido" not in headers
    assert ws.cell(row=8, column=_header_index(ws, "Prop. Certificacao no Linx")).value == "24/07/2026"
    assert ws.cell(row=8, column=_header_index(ws, "Fim Licenciamento (Linx)")).value in (None, "")


def test_products_report_marks_missing_certificate_registration(mocker, tmp_path):
    """SKU que o Linx nao respondeu nao pode parecer 'sem trava'."""
    _patch_products_report_io(mocker, tmp_path)

    output = generate_products_report([{"sku": "PI9999Y", "name": "X", "brand": "Puket"}])

    wb = openpyxl.load_workbook(output)
    ws = wb["Produtos"]
    assert (
        ws.cell(row=8, column=_header_index(ws, "Prop. Certificacao no Linx")).value
        == "Nao verificado (Linx indisponivel)"
    )
    assert ws.cell(row=8, column=_header_index(ws, "Ativo com Data no Linx")).value in (None, "")


class TestColunasD11:
    """O relatorio da reuniao 11/09: validade, fim de venda, trava e status de venda."""

    # Relogio congelado no dia da reuniao: sem isso o veredito de venda destes
    # cenarios mudaria sozinho quando os prazos reais vencessem.
    HOJE = date(2026, 9, 11)

    def _gerar(self, mocker, tmp_path, row, travas=None):
        _patch_products_report_io(mocker, tmp_path, travas=travas)
        output = generate_products_report([row], today=self.HOJE)
        return openpyxl.load_workbook(output)["Produtos"]

    def test_encerrado_mostra_validade_fim_de_venda_e_trava(self, mocker, tmp_path):
        ws = self._gerar(
            mocker,
            tmp_path,
            {
                "sku": "PI5914Y",
                "name": "PELUCIA MOZI",
                "brand": "Imaginarium",
                "situacao": "Encerrado",
                "validade_certificado": "2024-11-08",
                "sale_deadline": "29/10/2026",
                "sale_deadline_date": "2026-10-29",
                "encerramento_status": "Comerciação Permitida",
                "last_validation_status": "OK",
            },
            travas={"PI5914Y": {"cert": "29/10/2026", "lic": None, "indisponivel": None}},
        )

        def cell(label):
            return ws.cell(row=8, column=_header_index(ws, label)).value

        assert cell("Status Certificacao") == "Encerrado"
        assert cell("Validade do Certificado") == "08/11/2024"
        assert cell("Situacao (planilha)") == "Encerrado"
        assert cell("Fim de Venda (cert)") == "29/10/2026"
        assert cell("Data da Trava") == "29/10/2026"
        assert cell("Origem da Trava") == "Certificacao"
        assert cell("Status de Venda") == "Liberada"
        assert cell("FIM_VENDAS Linx atual") == "Nao lido"
        assert cell("Diverge do Linx") == "Nao verificavel"

    def test_ativo_com_data_no_linx_e_sinalizado_sem_trava(self, mocker, tmp_path):
        """Vitrola: ativa, com 22/03/2027 (a validade) gravada na propriedade."""
        ws = self._gerar(
            mocker,
            tmp_path,
            {
                "sku": "PI5555Y",
                "licenciamento_aplicavel": False,
                "name": "VITROLA DE MALA SEM FIO POR DO SOL",
                "brand": "Imaginarium",
                "situacao": "Ativo",
                "validade_certificado": "2027-03-22",
                "last_validation_status": "OK",
            },
            travas={"PI5555Y": {"cert": "22/03/2027", "lic": None, "indisponivel": None}},
        )

        def cell(label):
            return ws.cell(row=8, column=_header_index(ws, label)).value

        assert cell("Status Certificacao") == "Ativo"
        assert cell("Data da Trava") in (None, "")
        assert cell("Origem da Trava") in (None, "")
        assert cell("Status de Venda") == "Liberada"
        assert cell("Prop. Certificacao no Linx") == "22/03/2027"
        assert cell("Ativo com Data no Linx") == "Sim (22/03/2027)"

    def test_divergencia_com_o_fim_vendas_do_linx(self, mocker, tmp_path):
        ws = self._gerar(
            mocker,
            tmp_path,
            {
                "sku": "PI4511Y",
                "name": "CANETA MUDA FRASES HP FEITICOS",
                "brand": "Imaginarium",
                "situacao": "Encerrado",
                "sale_deadline": "02/03/2028",
                "sale_deadline_date": "2028-03-02",
                "encerramento_status": "Comerciação Permitida",
                "linx_fim_licenciamento": "2026-12-31",
                "linx_fim_vendas": "2028-03-02",
                "last_validation_status": "OK",
            },
            travas={"PI4511Y": {"cert": "02/03/2028", "lic": "31/12/2026", "indisponivel": None}},
        )

        def cell(label):
            return ws.cell(row=8, column=_header_index(ws, label)).value

        # A menor data real e a do licenciamento — o Linx esta travando pela outra.
        assert cell("Data da Trava") == "31/12/2026"
        assert cell("Origem da Trava") == "Licenciamento"
        assert cell("Fim Licenciamento (Linx)") == "31/12/2026"
        assert cell("FIM_VENDAS Linx atual") == "02/03/2028"
        assert cell("Diverge do Linx").startswith("Sim (02/03/2028 -> 31/12/2026")


class TestTravaFaturamento:
    """A trava vem do Linx (PROP_PRODUTOS), nunca de cert_certificates.

    A primeira versao lia a tabela do formulario do portal e reportava "sem
    trava" nas 658 linhas, enquanto o Linx tinha trava para 489 produtos.
    """

    def _rows(self):
        return [
            {"sku": "PI7223Y", "brand": "Imaginarium"},
            {"sku": "100400496", "brand": "Puket"},
        ]

    def test_le_a_propriedade_do_linx_e_mostra_a_data(self, mocker):
        from app.services import report_service

        mocker.patch(
            "app.db.sqlserver.fetch_produto_propriedades",
            side_effect=lambda brand, props, skus: (
                {"PI7223Y": {"00106": "24/07/2026", "00107": "31/12/2026"}}
                if brand == "Imaginarium"
                else {"100400496": {"00224": "11/08/2027"}}
            ),
        )
        travas = report_service._fetch_travas_faturamento(self._rows())

        assert travas["PI7223Y"] == {
            "cert": "24/07/2026", "lic": "31/12/2026", "indisponivel": None,
        }
        # Produto com validade mas sem licenciamento gravado.
        assert travas["100400496"] == {"cert": "11/08/2027", "lic": None, "indisponivel": None}

    def test_produto_sem_propriedade_sai_como_nao(self, mocker):
        from app.services import report_service

        mocker.patch("app.db.sqlserver.fetch_produto_propriedades", return_value={})
        travas = report_service._fetch_travas_faturamento(self._rows())
        assert travas["PI7223Y"] == {"cert": None, "lic": None, "indisponivel": None}

    def test_linx_fora_do_ar_nao_derruba_o_relatorio(self, mocker):
        """Dizer "sem trava" sem ter consultado seria afirmar o que nao se sabe."""
        from app.services import report_service

        mocker.patch(
            "app.db.sqlserver.fetch_produto_propriedades",
            side_effect=OSError("db02 unreachable"),
        )
        travas = report_service._fetch_travas_faturamento(self._rows())
        assert travas["PI7223Y"]["indisponivel"] == report_service.TRAVA_NAO_VERIFICADA
        assert travas["100400496"]["indisponivel"] == report_service.TRAVA_NAO_VERIFICADA
        assert travas["PI7223Y"]["cert"] is None

    def test_marca_sem_linx_e_sinalizada(self, mocker):
        from app.services import report_service

        mocker.patch("app.db.sqlserver.fetch_produto_propriedades", return_value={})
        travas = report_service._fetch_travas_faturamento([{"sku": "X1", "brand": "Kayuan"}])
        assert travas["X1"]["indisponivel"] == report_service.TRAVA_SEM_MARCA

    def test_consulta_uma_vez_por_marca_e_nao_por_sku(self, mocker):
        """658 produtos nao podem virar 658 idas ao SQL Server."""
        from app.services import report_service

        spy = mocker.patch("app.db.sqlserver.fetch_produto_propriedades", return_value={})
        report_service._fetch_travas_faturamento(
            [{"sku": f"PI{i}Y", "brand": "Imaginarium"} for i in range(300)]
        )
        assert spy.call_count == 1


class TestSentinelaDoLinx:
    """01/01/1900 e "campo criado sem data", nao trava — e e a maioria das linhas."""

    def test_sentinela_1900_nao_e_trava(self):
        from app.services.report_service import _trava_ativa

        assert _trava_ativa("01/01/1900") is None
        assert _trava_ativa("1900-01-01") is None

    def test_data_real_e_trava(self):
        from app.services.report_service import _trava_ativa

        assert _trava_ativa("24/07/2026") == "24/07/2026"
        assert _trava_ativa(" 11/08/2027 ") == "11/08/2027"

    def test_vazio_nao_e_trava(self):
        from app.services.report_service import _trava_ativa

        assert _trava_ativa("") is None
        assert _trava_ativa(None) is None

    def test_texto_nao_data_volta_como_veio(self):
        """Nao da para afirmar nem descartar — a operacao julga."""
        from app.services.report_service import _trava_ativa

        assert _trava_ativa("indeterminado") == "indeterminado"

    def test_sentinela_no_lookup_completo(self, mocker):
        from app.services import report_service

        mocker.patch(
            "app.db.sqlserver.fetch_produto_propriedades",
            return_value={"PI1Y": {"00106": "01/01/1900", "00107": "31/12/2027"}},
        )
        travas = report_service._fetch_travas_faturamento([{"sku": "PI1Y", "brand": "Imaginarium"}])
        assert travas["PI1Y"] == {"cert": None, "lic": "31/12/2027", "indisponivel": None}


def test_products_export_marks_previous_snapshot_when_sync_failed(mocker, tmp_path):
    mocker.patch("app.services.report_service.REPORTS_DIR", tmp_path)
    mocker.patch("app.services.report_service._fetch_stock_map", return_value={})
    mocker.patch("app.services.report_service._fetch_travas_faturamento", return_value={})
    warning = "Ultima sincronizacao falhou; snapshot anterior preservado"
    path = generate_products_report([{"sku": "TEST-SNAPSHOT"}], sync_warning=warning)
    workbook = openpyxl.load_workbook(path)
    assert workbook["Produtos"]["A4"].value == warning
