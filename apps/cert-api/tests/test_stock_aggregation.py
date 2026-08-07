"""Agregacao de estoque: colisoes de chave e paridade painel x relatorio.

Casos medidos em producao em 2026-08-07 (PI7223Y e o SKU citado pela Eduarda).
"""

from app.services.wms_service import (
    _aggregate_ecommerce,
    _aggregate_wms,
    summarize_stock_rows,
)


class TestAggregateWms:
    """A chave de cert_stock e (sku, source, warehouse) — sem SITUACAO."""

    def test_soma_situacoes_da_mesma_area_em_vez_de_sobrescrever(self):
        """A query do Oracle agrupa por SITUACAO; o upsert nao. 360 pares (sku,
        area) tinham mais de uma situacao e perdiam estoque no ON CONFLICT."""
        rows = [
            {"CD_PRODUTO": "PI7223Y", "AREA": "PICKING", "SITUACAO": "ENDEREÇO OCUPADO",
             "ESTOQUE": 300, "RESERVA": 0, "TRANSITO": 0, "DISPONIVEL": 300},
            {"CD_PRODUTO": "PI7223Y", "AREA": "PICKING", "SITUACAO": "ENDEREÇO VAZIO",
             "ESTOQUE": 7, "RESERVA": 0, "TRANSITO": 0, "DISPONIVEL": 7},
        ]
        out = _aggregate_wms(rows, {})
        assert len(out) == 1
        assert out[0]["quantity"] == 307
        assert out[0]["available"] == 307
        assert out[0]["situation"] == "ENDEREÇO OCUPADO, ENDEREÇO VAZIO"

    def test_areas_diferentes_seguem_separadas(self):
        rows = [
            {"CD_PRODUTO": "PI7223Y", "AREA": "PICKING", "SITUACAO": "X",
             "ESTOQUE": 300, "RESERVA": 0, "TRANSITO": 0, "DISPONIVEL": 300},
            {"CD_PRODUTO": "PI7223Y", "AREA": "EXPEDIÇÃO", "SITUACAO": "X",
             "ESTOQUE": 18, "RESERVA": 18, "TRANSITO": 0, "DISPONIVEL": 0},
        ]
        out = _aggregate_wms(rows, {})
        assert {i["warehouse"] for i in out} == {"CD PICKING", "CD EXPEDIÇÃO"}

    def test_traduz_ean_para_sku(self):
        """O WMS identifica a Puket por codigo de barras, nao pelo codigo do produto."""
        rows = [
            {"CD_PRODUTO": "7909692243913", "AREA": "PICKING", "SITUACAO": "X",
             "ESTOQUE": 5, "RESERVA": 0, "TRANSITO": 0, "DISPONIVEL": 5},
        ]
        out = _aggregate_wms(rows, {"7909692243913": "100400496"})
        assert out[0]["sku"] == "100400496"

    def test_sem_mapa_mantem_o_codigo_original(self):
        rows = [
            {"CD_PRODUTO": "7909692243913", "AREA": "PICKING", "SITUACAO": "X",
             "ESTOQUE": 5, "RESERVA": 0, "TRANSITO": 0, "DISPONIVEL": 5},
        ]
        out = _aggregate_wms(rows, {})
        assert out[0]["sku"] == "7909692243913"

    def test_ignora_linha_sem_codigo(self):
        rows = [{"CD_PRODUTO": "  ", "AREA": "PICKING", "ESTOQUE": 9}]
        assert _aggregate_wms(rows, {}) == []


class TestAggregateEcommerce:
    def test_soma_as_cores_do_mesmo_produto(self):
        """estoque_produtos tem uma linha por (PRODUTO, COR_PRODUTO): 10.117
        linhas para 9.503 produtos na Puket. As cores colidiam no upsert."""
        rows = [
            {"PRODUTO": "100400496   ", "COR_PRODUTO": "001", "ESTOQUE": 13},
            {"PRODUTO": "100400496   ", "COR_PRODUTO": "002", "ESTOQUE": 7},
            {"PRODUTO": "010100114", "COR_PRODUTO": "108", "ESTOQUE": 4},
        ]
        out = {i["sku"]: i["quantity"] for i in _aggregate_ecommerce(rows)}
        assert out == {"100400496": 20, "010100114": 4}

    def test_tolera_chaves_minusculas_e_nulos(self):
        rows = [{"produto": "X1", "estoque": None}, {"produto": "X1", "estoque": 3}]
        assert _aggregate_ecommerce(rows) == [{"sku": "X1", "quantity": 3}]


class TestSummarizeStockRows:
    """Painel e relatorio precisam somar EXATAMENTE do mesmo jeito."""

    # Estoque real do PI7223Y em 07/08/2026. A area EXPEDIÇÃO tem available=0 e
    # quantity=18: era o `available or quantity` do painel que virava 18 ali e
    # produzia 462 na tela contra 444 no Excel.
    PI7223Y = [
        {"sku": "PI7223Y", "source": "wms_biguacu", "warehouse": "CD ASTEC",
         "quantity": 23, "available": 23, "synced_at": "2026-03-23T21:45:19"},
        {"sku": "PI7223Y", "source": "wms_biguacu", "warehouse": "CD CD PERDA",
         "quantity": 10, "available": 10, "synced_at": "2026-03-23T21:45:19"},
        {"sku": "PI7223Y", "source": "wms_biguacu", "warehouse": "CD CLASSE C",
         "quantity": 13, "available": 13, "synced_at": "2026-03-23T21:45:19"},
        {"sku": "PI7223Y", "source": "wms_biguacu", "warehouse": "CD ESTOQUE ARMAZEM",
         "quantity": 90, "available": 90, "synced_at": "2026-03-23T21:45:19"},
        {"sku": "PI7223Y", "source": "wms_biguacu", "warehouse": "CD EXPEDIÇÃO",
         "quantity": 18, "available": 0, "synced_at": "2026-03-23T21:45:19"},
        {"sku": "PI7223Y", "source": "wms_biguacu", "warehouse": "CD PICKING",
         "quantity": 307, "available": 307, "synced_at": "2026-03-23T21:45:19"},
        {"sku": "PI7223Y", "source": "wms_biguacu", "warehouse": "CD TRANSIÇÃO CLASSE C",
         "quantity": 1, "available": 1, "synced_at": "2026-03-23T21:45:19"},
        {"sku": "PI7223Y", "source": "ecommerce_imaginarium", "warehouse": "Extrema MG",
         "quantity": 38, "available": 38, "synced_at": "2026-03-23T21:45:19"},
    ]

    def test_disponivel_zero_nao_vira_quantidade(self):
        resumo = summarize_stock_rows(self.PI7223Y)["PI7223Y"]
        assert resumo["stock_cd"] == 444
        assert resumo["stock_ecommerce"] == 38
        assert resumo["stock_total"] == 482

    def test_detalhe_preserva_quantidade_e_disponivel(self):
        detalhe = summarize_stock_rows(self.PI7223Y)["PI7223Y"]["stock_detail"]
        expedicao = next(d for d in detalhe if d["warehouse"] == "CD EXPEDIÇÃO")
        assert (expedicao["quantity"], expedicao["available"]) == (18, 0)

    def test_expoe_a_data_do_sync_mais_recente(self):
        rows = [
            {"sku": "A", "source": "wms_biguacu", "warehouse": "CD X",
             "quantity": 1, "available": 1, "synced_at": "2026-03-23T21:45:19"},
            {"sku": "A", "source": "ecommerce_puket", "warehouse": "Extrema MG",
             "quantity": 2, "available": 2, "synced_at": "2026-08-07T09:00:00"},
        ]
        assert summarize_stock_rows(rows)["A"]["stock_synced_at"] == "2026-08-07T09:00:00"

    def test_sku_ausente_nao_quebra(self):
        assert summarize_stock_rows([{"source": "wms_biguacu", "available": 5}]) == {}
