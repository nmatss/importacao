"""Gate de volume antes do DELETE + INSERT de `cert_stock`.

O sync substitui a fonte inteira. Uma consulta que devolve zero linha SEM
levantar excecao (sessao sem permissao, filtro que nao casa nada, mapa de
barcode que nao traduziu nada) apagava o estoque e deixava todo SKU com 0 no
CD — o sintoma "o item sumiu do WMS" na escala da base toda.
"""

import pytest

from app.services.wms_service import StockSnapshotRejectedError, _assert_snapshot_plausible


class FakeCursor:
    """Cursor minimo que responde o COUNT do snapshot anterior."""

    def __init__(self, previous: int):
        self._previous = previous
        self.executed: list[tuple] = []

    def execute(self, sql, params=None):
        self.executed.append((sql, params))

    def fetchone(self):
        return {"n": self._previous}


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    monkeypatch.delenv("CERT_STOCK_SYNC_FORCE", raising=False)
    monkeypatch.delenv("CERT_STOCK_SYNC_MAX_DROP_PCT", raising=False)


class TestSnapshotVazio:
    def test_recusa_apagar_estoque_existente_com_snapshot_vazio(self):
        cur = FakeCursor(previous=33416)
        with pytest.raises(StockSnapshotRejectedError, match="snapshot vazio"):
            _assert_snapshot_plausible(cur, "wms_biguacu", 0)

    def test_primeira_carga_da_fonte_e_permitida(self):
        """Sem nada gravado nao ha o que proteger — bootstrap tem que passar."""
        cur = FakeCursor(previous=0)
        _assert_snapshot_plausible(cur, "wms_biguacu", 0)


class TestQuedaDeVolume:
    def test_recusa_queda_acima_do_limite(self):
        cur = FakeCursor(previous=1000)
        with pytest.raises(StockSnapshotRejectedError, match="caiu"):
            _assert_snapshot_plausible(cur, "ecommerce_puket", 400)

    def test_aceita_queda_dentro_do_limite(self):
        cur = FakeCursor(previous=1000)
        _assert_snapshot_plausible(cur, "ecommerce_puket", 600)

    def test_aceita_crescimento(self):
        cur = FakeCursor(previous=1000)
        _assert_snapshot_plausible(cur, "ecommerce_puket", 5000)

    def test_limite_configuravel(self, monkeypatch):
        monkeypatch.setenv("CERT_STOCK_SYNC_MAX_DROP_PCT", "90")
        cur = FakeCursor(previous=1000)
        _assert_snapshot_plausible(cur, "ecommerce_puket", 200)

    @pytest.mark.parametrize("bad", ["", "abc", "0", "-10", "500"])
    def test_valor_invalido_cai_no_padrao_em_vez_de_desligar_o_gate(self, monkeypatch, bad):
        monkeypatch.setenv("CERT_STOCK_SYNC_MAX_DROP_PCT", bad)
        cur = FakeCursor(previous=1000)
        with pytest.raises(StockSnapshotRejectedError):
            _assert_snapshot_plausible(cur, "ecommerce_puket", 100)


class TestOverrideExplicito:
    def test_force_permite_a_substituicao(self, monkeypatch):
        """Existe saida manual, mas ela tem que ser deliberada."""
        monkeypatch.setenv("CERT_STOCK_SYNC_FORCE", "1")
        cur = FakeCursor(previous=33416)
        _assert_snapshot_plausible(cur, "wms_biguacu", 0)
        assert cur.executed == [], "com FORCE nao precisa nem consultar o anterior"

    def test_valor_diferente_de_1_nao_libera(self, monkeypatch):
        monkeypatch.setenv("CERT_STOCK_SYNC_FORCE", "true")
        cur = FakeCursor(previous=33416)
        with pytest.raises(StockSnapshotRejectedError):
            _assert_snapshot_plausible(cur, "wms_biguacu", 0)


class TestIsolamentoPorFonte:
    def test_o_count_e_filtrado_pela_fonte(self):
        """Uma fonte nao pode ser avaliada pelo volume da outra."""
        cur = FakeCursor(previous=10)
        _assert_snapshot_plausible(cur, "ecommerce_imaginarium", 10)
        sql, params = cur.executed[0]
        assert "source = %s" in sql
        assert params == ("ecommerce_imaginarium",)
