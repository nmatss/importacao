"""Tests for WMS and ERP stock fetch functions."""


from app.db.oracle import fetch_wms_stock
from app.db.sqlserver import fetch_ecommerce_stock


class TestFetchWmsStock:
    def test_returns_list(self, mock_oracle_conn):
        """fetch_wms_stock should return a list (empty when cursor has no rows)."""
        mock_oracle_conn.fetchall.return_value = []
        mock_oracle_conn.description = []
        result = fetch_wms_stock()
        assert isinstance(result, list)

    def test_maps_columns(self, mock_oracle_conn):
        """fetch_wms_stock should map column names to dict keys."""
        mock_oracle_conn.description = [
            ("CD_PRODUTO",), ("DS_PRODUTO",), ("AREA",), ("SITUACAO",),
            ("ESTOQUE",), ("RESERVA",), ("TRANSITO",), ("DISPONIVEL",),
        ]
        mock_oracle_conn.fetchall.return_value = [
            ("SKU001", "Produto Teste", "Picking", "Normal", 100, 10, 5, 85),
        ]
        result = fetch_wms_stock()
        assert len(result) == 1
        assert result[0]["CD_PRODUTO"] == "SKU001"
        assert result[0]["ESTOQUE"] == 100


class TestFetchEcommerceStock:
    def test_puket_returns_list(self, mock_sqlserver_conn):
        """fetch_ecommerce_stock for puket should return a list."""
        mock_sqlserver_conn.fetchall.return_value = []
        result = fetch_ecommerce_stock("puket")
        assert isinstance(result, list)

    def test_imaginarium_returns_list(self, mock_sqlserver_conn):
        """fetch_ecommerce_stock for imaginarium should return a list."""
        mock_sqlserver_conn.fetchall.return_value = []
        result = fetch_ecommerce_stock("imaginarium")
        assert isinstance(result, list)

    def test_puket_escolares_uses_puket_db(self, mock_sqlserver_conn, mocker):
        """puket_escolares brand should connect to Puket ERP host."""
        import pymssql
        mocker.patch("app.db.sqlserver.ERP_PUKET_HOST", "puket-test-host")
        mocker.patch("app.db.sqlserver.ERP_PUKET_DB", "puket_test_db")
        mocker.patch("app.db.sqlserver.ERP_MSSQL_USER", "erp-test-user")
        mocker.patch("app.db.sqlserver.ERP_MSSQL_PASS", "erp-test-pass")
        mock_sqlserver_conn.fetchall.return_value = []
        fetch_ecommerce_stock("puket_escolares")
        call_args = pymssql.connect.call_args
        assert call_args.args[:4] == ("puket-test-host", "erp-test-user", "erp-test-pass", "puket_test_db")
