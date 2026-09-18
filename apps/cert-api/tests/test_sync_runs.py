"""Sync manual da planilha: lock compartilhado, historico e endpoint (D11)."""

import pytest

from app.services import sync_runs


def _db_ctx(mocker, cursor):
    ctx = mocker.MagicMock()
    ctx.__enter__ = mocker.MagicMock(return_value=(mocker.MagicMock(), cursor))
    ctx.__exit__ = mocker.MagicMock(return_value=False)
    return ctx


def _mock_lock_conn(mocker, locked: bool):
    """Conexao dedicada do lock advisory, com o resultado de pg_try_advisory_lock."""
    mocker.patch.object(sync_runs, "DATABASE_URL", "postgres://test")
    cur = mocker.MagicMock()
    cur.fetchone.return_value = (locked,)
    cur.__enter__ = mocker.MagicMock(return_value=cur)
    cur.__exit__ = mocker.MagicMock(return_value=False)
    conn = mocker.MagicMock()
    conn.cursor.return_value = cur
    mocker.patch.object(sync_runs, "get_conn", return_value=conn)
    mocker.patch.object(sync_runs, "put_conn")
    return conn, cur


def test_lock_is_released_and_connection_returned(mocker):
    """O lock e de SESSAO: sem unlock+putconn a conexao fica presa no pool."""
    conn, cur = _mock_lock_conn(mocker, locked=True)
    with sync_runs.sheet_sync_lock() as acquired:
        assert acquired is True
    executed = " ".join(str(c.args[0]) for c in cur.execute.call_args_list)
    assert "pg_try_advisory_lock" in executed
    assert "pg_advisory_unlock" in executed
    sync_runs.put_conn.assert_called_once_with(conn, close=False)


def test_lock_not_acquired_does_not_unlock(mocker):
    """Quem nao tomou o lock nao pode libera-lo — soltaria o lock do outro."""
    conn, cur = _mock_lock_conn(mocker, locked=False)
    with sync_runs.sheet_sync_lock() as acquired:
        assert acquired is False
    executed = " ".join(str(c.args[0]) for c in cur.execute.call_args_list)
    assert "pg_advisory_unlock" not in executed
    sync_runs.put_conn.assert_called_once_with(conn, close=False)


def test_lock_released_even_when_the_body_raises(mocker):
    conn, cur = _mock_lock_conn(mocker, locked=True)
    with pytest.raises(RuntimeError), sync_runs.sheet_sync_lock():
        raise RuntimeError("sync falhou")
    executed = " ".join(str(c.args[0]) for c in cur.execute.call_args_list)
    assert "pg_advisory_unlock" in executed


def test_failed_unlock_closes_the_connection_instead_of_recycling_the_lock(mocker):
    """Lock de sessao em conexao reciclada = "ja em andamento" para sempre."""
    conn, cur = _mock_lock_conn(mocker, locked=True)

    def execute(sql, params=None):
        if "pg_advisory_unlock" in sql:
            raise RuntimeError("conexao em estado invalido")

    cur.execute.side_effect = execute
    with sync_runs.sheet_sync_lock() as acquired:
        assert acquired is True
    sync_runs.put_conn.assert_called_once_with(conn, close=True)


def test_lock_is_a_noop_without_a_database(mocker):
    """Sem Postgres nao ha lock nem historico, mas o sync continua rodando.

    Exigir banco aqui transformaria uma melhoria de coordenacao em regressao
    para a configuracao que roda so com o Google Sheets.
    """
    mocker.patch.object(sync_runs, "DATABASE_URL", "")
    get_conn = mocker.patch.object(sync_runs, "get_conn")

    with sync_runs.sheet_sync_lock() as acquired:
        assert acquired is True
    get_conn.assert_not_called()
    assert sync_runs.start_sync_run("manual") is None


def test_start_sync_run_rejects_unknown_trigger():
    """O CHECK da tabela so aceita manual/startup/schedule/hourly."""
    with pytest.raises(ValueError):
        sync_runs.start_sync_run("qualquer")


def test_run_sheet_sync_records_result_and_runs_linx(mocker):
    _mock_lock_conn(mocker, locked=True)
    mocker.patch.object(sync_runs, "start_sync_run", return_value="run-1")
    finish = mocker.patch.object(sync_runs, "finish_sync_run")
    mocker.patch("app.services.erp_service.sync_sheets_to_db", return_value={"synced": 674})
    mocker.patch("app.services.linx_attributes.sync_linx_attributes", return_value={"updated": 674})

    result = sync_runs.run_sheet_sync("manual", "odett@grupounico.com")

    assert result["locked"] is True
    assert result["sheets"] == {"synced": 674}
    assert result["linx"] == {"updated": 674}
    sync_runs.start_sync_run.assert_called_once_with("manual", "odett@grupounico.com")
    finish.assert_called_once()
    assert finish.call_args.args[0] == "run-1"


def test_run_sheet_sync_survives_linx_failure(mocker):
    """Linx fora do ar nao derruba o sync da planilha ja aplicado."""
    _mock_lock_conn(mocker, locked=True)
    mocker.patch.object(sync_runs, "start_sync_run", return_value="run-1")
    finish = mocker.patch.object(sync_runs, "finish_sync_run")
    mocker.patch("app.services.erp_service.sync_sheets_to_db", return_value={"synced": 10})
    mocker.patch(
        "app.services.linx_attributes.sync_linx_attributes",
        side_effect=OSError("Login failed for private-user@private-host"),
    )

    result = sync_runs.run_sheet_sync("hourly")

    assert result["sheets"] == {"synced": 10}
    assert result["linx"] == {"error": "OSError"}
    # O tipo da excecao basta; a mensagem do pymssql carrega host/login.
    assert "private-host" not in str(finish.call_args)


def test_run_sheet_sync_closes_the_run_when_sheets_fails(mocker):
    _mock_lock_conn(mocker, locked=True)
    mocker.patch.object(sync_runs, "start_sync_run", return_value="run-1")
    finish = mocker.patch.object(sync_runs, "finish_sync_run")
    mocker.patch("app.services.erp_service.sync_sheets_to_db", side_effect=RuntimeError("boom"))

    with pytest.raises(RuntimeError):
        sync_runs.run_sheet_sync("schedule")

    # Sem isso a linha ficaria sem finished_at e a tela leria "sincronizando" para sempre.
    finish.assert_called_once()
    assert finish.call_args.args[2].startswith("RuntimeError")


def test_run_sheet_sync_skips_when_another_run_holds_the_lock(mocker):
    _mock_lock_conn(mocker, locked=False)
    sheets = mocker.patch("app.services.erp_service.sync_sheets_to_db")

    result = sync_runs.run_sheet_sync("manual")

    assert result["locked"] is False
    sheets.assert_not_called()


@pytest.mark.asyncio
async def test_sync_sheets_endpoint_records_actor(test_client, api_key_headers, mocker):
    """POST /api/sync-sheets registra o ator do gateway em cert_sync_runs."""
    from app.routes import certifications

    mocker.patch.object(certifications, "SHEETS_CLIENT_EMAIL", "svc@example.invalid")
    mocker.patch.object(certifications, "SHEETS_PRIVATE_KEY", "key")
    run = mocker.patch.object(
        certifications,
        "run_sheet_sync",
        return_value={"locked": True, "trigger": "manual", "run_id": "r1", "sheets": {"synced": 3}},
    )

    resp = await test_client.post(
        "/api/sync-sheets",
        headers={**api_key_headers, "X-Cert-Actor-Email": "odett@grupounico.com"},
    )

    assert resp.status_code == 200
    assert resp.json()["sheets"] == {"synced": 3}
    run.assert_called_once_with("manual", "odett@grupounico.com")


@pytest.mark.asyncio
async def test_sync_sheets_endpoint_returns_409_when_locked(
    test_client, api_key_headers, mocker
):
    from app.routes import certifications

    mocker.patch.object(certifications, "SHEETS_CLIENT_EMAIL", "svc@example.invalid")
    mocker.patch.object(certifications, "SHEETS_PRIVATE_KEY", "key")
    mocker.patch.object(
        certifications,
        "run_sheet_sync",
        return_value={"locked": False, "trigger": "manual", "run_id": None},
    )

    resp = await test_client.post("/api/sync-sheets", headers=api_key_headers)

    assert resp.status_code == 409
    assert "andamento" in resp.json()["detail"]


@pytest.mark.asyncio
async def test_sync_sheets_endpoint_tells_the_operator_the_actionable_cause(
    test_client, api_key_headers, mocker
):
    """O resumo da execucao sempre vencia o `or`, e o motivo real nunca chegava ao toast."""
    from app.routes import certifications

    mocker.patch.object(certifications, "SHEETS_CLIENT_EMAIL", "svc@example.invalid")
    mocker.patch.object(certifications, "SHEETS_PRIVATE_KEY", "key")
    mocker.patch.object(
        certifications,
        "run_sheet_sync",
        return_value={
            "locked": True,
            "trigger": "manual",
            "run_id": "r1",
            "status": "error",
            "error": "Sincronizacao da planilha falhou; leitura do Linx concluida",
            "sheets": {"synced": 0, "error": "Esquema de Encerramentos invalido: status"},
            "linx": {"updated": 674, "errors": []},
        },
    )

    resp = await test_client.post("/api/sync-sheets", headers=api_key_headers)

    assert resp.status_code == 502
    detail = resp.json()["detail"]
    assert "planilha falhou" in detail
    assert "Motivo: Esquema de Encerramentos invalido: status" in detail


@pytest.mark.asyncio
async def test_last_sync_endpoint_without_db(test_client, api_key_headers):
    """Sem banco a rota devolve o formato vazio, nao 500."""
    resp = await test_client.get("/api/sync-sheets/last", headers=api_key_headers)
    assert resp.status_code == 200
    assert resp.json() == {"last_run": None}


@pytest.mark.asyncio
async def test_last_sync_endpoint_returns_the_last_run(test_client, api_key_headers, mocker):
    from app.routes import certifications

    mocker.patch.object(certifications, "DATABASE_URL", "postgres://test")
    mocker.patch.object(
        certifications,
        "fetch_last_sync_run",
        return_value={
            "id": "r1",
            "trigger": "manual",
            "actor": "odett@grupounico.com",
            "started_at": "2026-09-11T12:00:00+00:00",
            "finished_at": "2026-09-11T12:00:20+00:00",
            "result": {"sheets": {"synced": 674}},
            "error": None,
        },
    )

    resp = await test_client.get("/api/sync-sheets/last", headers=api_key_headers)

    assert resp.status_code == 200
    assert resp.json()["last_run"]["actor"] == "odett@grupounico.com"


def test_serialize_sync_run_converts_timestamps(mocker):
    from datetime import UTC, datetime

    row = {
        "id": "11111111-1111-1111-1111-111111111111",
        "started_at": datetime(2026, 9, 11, 12, 0, tzinfo=UTC),
        "finished_at": None,
        "trigger": "hourly",
    }
    out = sync_runs.serialize_sync_run(row)
    assert out["started_at"] == "2026-09-11T12:00:00+00:00"
    assert out["finished_at"] is None


def test_fetch_last_sync_run_returns_none_on_empty_table(mocker):
    cur = mocker.MagicMock()
    cur.fetchone.return_value = None
    mocker.patch.object(sync_runs, "db", return_value=_db_ctx(mocker, cur))
    assert sync_runs.fetch_last_sync_run() is None
