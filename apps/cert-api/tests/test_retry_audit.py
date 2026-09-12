"""Retry audit keeps the gateway actor and excludes ERP/document payloads."""

import json
from contextlib import contextmanager

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from app.routes import certificates


@contextmanager
def _lock(_key):
    yield True


def _events(caplog):
    return [
        json.loads(record.message)
        for record in caplog.records
        if record.message.startswith('{"event": "certificate_retry"')
    ]


def _request():
    return Request(
        {
            "type": "http",
            "headers": [(b"x-cert-actor-email", b"analista@example.test\nforged-log")],
            "client": ("127.0.0.1", 1),
        }
    )


@pytest.mark.parametrize("status", ["applied", "pending", "disabled", "error"])
def test_retry_records_actor_and_sanitized_result(mocker, caplog, status):
    caplog.set_level("INFO", logger="cert-api")
    mocker.patch.object(certificates, "sheet_sync_lock", _lock)
    result = {"linx_status": status, "linx_error": "private ERP connection", "linx_detail": "document payload"}
    mocker.patch.object(certificates, "_retry_linx_locked", return_value=result)
    response = certificates.retry_linx.__wrapped__(_request(), "certificate-1")
    assert response == result
    events = _events(caplog)
    assert [e["phase"] for e in events] == ["started", "failed" if status == "error" else "finished"]
    assert all(e["actor"] == "analista@example.test\nforged-log" for e in events)
    assert events[-1]["status"] == status
    assert all("\n" not in record.message for record in caplog.records)
    assert "private ERP" not in caplog.text
    assert "document payload" not in caplog.text


@pytest.mark.parametrize("error", [HTTPException(409, "private detail"), RuntimeError("credential material")])
def test_retry_exception_logs_class_and_status_only(mocker, caplog, error):
    caplog.set_level("INFO", logger="cert-api")
    mocker.patch.object(certificates, "sheet_sync_lock", _lock)
    mocker.patch.object(certificates, "_retry_linx_locked", side_effect=error)
    with pytest.raises(type(error)):
        certificates.retry_linx.__wrapped__(_request(), "certificate-1")
    failed = _events(caplog)[-1]
    assert failed["phase"] == "failed"
    assert failed["http_status"] == (409 if isinstance(error, HTTPException) else 500)
    assert "private detail" not in caplog.text
    assert "credential material" not in caplog.text
