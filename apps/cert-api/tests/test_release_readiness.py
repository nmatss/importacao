"""Release gates and startup side effects, without remote writes."""

import pytest
import requests

from app.db import release_migrations as release
from app.services import marketplace_audit as marketplace


def test_release_cli_defaults_to_read_only(mocker):
    apply = mocker.patch.object(release, "apply_release_migrations")
    check = mocker.patch.object(release, "verify_item_restriction_schema")
    mocker.patch.object(release, "close_pool")
    assert release.main([]) == 0
    check.assert_called_once()
    apply.assert_not_called()


def test_release_apply_checks_after_explicit_sql(mocker):
    events = []
    mocker.patch.object(release, "ensure_tables", side_effect=lambda: events.append("base"))
    context = mocker.MagicMock()
    context.__enter__.return_value = (mocker.MagicMock(), mocker.MagicMock())
    context.__enter__.return_value[1].execute.side_effect = lambda sql: events.append(
        "restriction" if "BEGIN;" in sql else "unexpected"
    )
    mocker.patch.object(release, "db", return_value=context)
    mocker.patch.object(release, "verify_item_restriction_schema", side_effect=lambda: events.append("check"))
    release.apply_release_migrations()
    assert events == ["base", "restriction", "check"]


def test_release_failure_exits_nonzero_without_printing_database_error(mocker, capsys):
    mocker.patch.object(
        release, "verify_item_restriction_schema", side_effect=RuntimeError("private connection details")
    )
    mocker.patch.object(release, "close_pool")
    assert release.main(["--check"]) == 1
    assert "private connection" not in capsys.readouterr().out


def test_startup_checks_schema_without_ddl_or_legacy_licensing(mocker):
    import app.main as main

    mocker.patch.object(main, "DATABASE_URL", "configured")
    mocker.patch.object(main, "SHEETS_CLIENT_EMAIL", "configured")
    mocker.patch.object(main, "SHEETS_PRIVATE_KEY", "configured")
    mocker.patch.object(main, "validate_linx_config")
    check = mocker.patch("app.db.postgres.verify_item_restriction_schema")
    ddl = mocker.patch("app.db.postgres.ensure_tables")
    legacy = mocker.patch("app.services.erp_service.sync_licenciados_to_db")
    sync = mocker.patch("app.services.sync_runs.run_sheet_sync", return_value={})
    mocker.patch.object(main.scheduler, "start")
    mocker.patch.object(main, "load_schedules_into_scheduler")
    mocker.patch.object(main, "schedule_hourly_sheet_sync")
    main.run_startup()
    check.assert_called_once()
    ddl.assert_not_called()
    legacy.assert_not_called()
    sync.assert_called_once_with("startup")


@pytest.mark.asyncio
async def test_patch_preflight_is_allowed(test_client):
    import app.main as main

    cors = next(m for m in main.app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    assert "PATCH" in cors.kwargs["allow_methods"]


@pytest.mark.parametrize("payload", [{}, {"products": None}, {"products": {}}])
def test_invalid_marketplace_schema_cannot_persist_empty_success(mocker, payload):
    mocker.patch.object(
        marketplace.requests, "get", return_value=mocker.MagicMock(status_code=200, **{"json.return_value": payload})
    )
    persist = mocker.patch.object(marketplace, "persist_audit")
    with pytest.raises(requests.RequestException):
        marketplace.run_audit()
    persist.assert_not_called()


def test_later_http_error_cannot_persist_partial_inventory(mocker):
    full = mocker.MagicMock(status_code=200, **{"json.return_value": {"products": [{}] * marketplace._PAGE_SIZE}})
    failed = mocker.MagicMock(status_code=503)
    mocker.patch.object(marketplace.requests, "get", side_effect=[full, failed])
    mocker.patch.object(marketplace, "VTEX_REQUEST_DELAY", 0)
    persist = mocker.patch.object(marketplace, "persist_audit")
    with pytest.raises(requests.RequestException, match="503"):
        marketplace.run_audit()
    persist.assert_not_called()
