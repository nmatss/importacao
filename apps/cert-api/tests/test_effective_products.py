from datetime import date
from unittest.mock import MagicMock

import pytest

from app.services.derivation import compute_status_dimensions
from app.services.effective_products import execute_product_query


def test_product_query_preserves_bound_parameters_and_refuses_writes():
    cur = MagicMock()
    params = ["SKU'; DROP TABLE cert_products; --"]
    execute_product_query(cur, "SELECT * FROM cert_products WHERE sku = %s", params)
    sql, bound = cur.execute.call_args.args
    assert sql.startswith("\nWITH cadastro_links")
    assert bound is params
    assert params[0] not in sql
    with pytest.raises(ValueError):
        execute_product_query(cur, "DELETE FROM cert_products")


@pytest.mark.parametrize("license_date, expected", [(None, "PENDENTE"), (date(2020, 1, 1), "BLOQUEADA")])
def test_conflict_never_claims_certification_or_sale_is_confirmed(license_date, expected):
    result = compute_status_dimensions({
        "situacao": "PENDENTE_CADASTRO", "sheet_status": "Conflito: fonte A e cadastro B",
        "numero_certificado": "A", "last_validation_status": "OK",
        "linx_fim_licenciamento": license_date,
        "linx_synced_at": "2026-09-18", "grife": "Disney",
    }, today=date(2026, 9, 18))
    assert result["cert_status"] == "PENDENTE"
    assert result["cert_status_reason"] == "Conflito: fonte A e cadastro B"
    assert result["comercializacao_status"] == "PENDENTE"
    assert result["status_venda"] == expected
    assert result["site_status"] == "NAO_CONFORME"
