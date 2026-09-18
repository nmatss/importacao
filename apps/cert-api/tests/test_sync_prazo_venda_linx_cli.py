"""CLI output consumes real dry-run result shapes without touching the ERP."""

import importlib.util
import sys
from pathlib import Path

import pytest

from app.services import erp_service, linx_service


@pytest.fixture
def cli(monkeypatch):
    script = Path(__file__).resolve().parents[1] / "scripts" / "sync_prazo_venda_linx.py"
    spec = importlib.util.spec_from_file_location("sync_prazo_venda_linx_cli_test", script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setattr(sys, "argv", [str(script)])
    monkeypatch.setattr(linx_service, "_salvar_relatorio_sync", lambda result: "/synthetic/report.json")
    monkeypatch.setattr(
        linx_service, "upsert_produto_propriedade", lambda *args: pytest.fail("CLI must not write to ERP")
    )
    return module


@pytest.mark.parametrize("different_deadlines", [False, True])
def test_cli_renders_both_actual_ambiguity_shapes(cli, monkeypatch, capsys, different_deadlines):
    lines = [{"sku": "SYNTHETIC", "brand": "PUKET", "sale_deadline": "01/01/2020", "certificado": "OLD"}]
    if different_deadlines:
        lines.append({**lines[0], "sale_deadline": "02/01/2020", "certificado": "OTHER"})
    monkeypatch.setattr(erp_service, "read_encerramentos_prazos", lambda: lines)
    monkeypatch.setattr(
        erp_service,
        "read_situacao_por_sku",
        lambda: {"SYNTHETIC": {"situacao": "Ativo", "numero_certificado": "NEW"}},
    )
    assert cli.main() == 0
    output = capsys.readouterr().out
    assert "SYNTHETIC" in output and "OLD" in output
    assert ("OTHER" if different_deadlines else "NEW") in output
    assert "/synthetic/report.json" in output
    assert "Para gravar de fato" not in output
    assert "unico caminho de rollback" not in output


def test_cli_apply_reports_blocked_without_claiming_execution(cli, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["sync_prazo_venda_linx.py", "--apply"])
    monkeypatch.setattr(linx_service, "LINX_WRITE_ENABLED", True)
    monkeypatch.setattr(
        erp_service, "read_encerramentos_prazos", lambda: pytest.fail("Blocked apply must not read sources")
    )
    assert cli.main() == 1
    captured = capsys.readouterr()
    assert "bloqueada" in captured.err
    assert "APLICANDO NO LINX" not in captured.out


def test_cli_help_explains_apply_gate(cli, monkeypatch, capsys):
    monkeypatch.setattr(sys, "argv", ["sync_prazo_venda_linx.py", "--help"])
    with pytest.raises(SystemExit) as result:
        cli.main()
    assert result.value.code == 0
    output = capsys.readouterr().out
    assert "grava de fato" not in output
    assert "bloqueado" in output.lower()
