"""API key authentication utilities."""

import hmac
import os

from fastapi import HTTPException, Request, Security
from fastapi.security import APIKeyHeader

from app.utils.logging import log

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


def _get_api_key() -> str:
    """Read CERT_API_KEY from environment at call time (supports test overrides).

    Returns:
        Current value of the CERT_API_KEY env var, or empty string if not set.
    """
    return os.environ.get("CERT_API_KEY", "")


async def verify_api_key(request: Request, api_key: str = Security(api_key_header)) -> None:
    """Verify API key from X-API-Key header.

    Skips verification for /api/health. Warns if CERT_API_KEY is not set.

    Args:
        request: Incoming HTTP request.
        api_key: Value from X-API-Key header.

    Raises:
        HTTPException: 403 if API key is configured and the provided key is invalid.
    """
    if request.url.path == "/api/health":
        return
    configured_key = _get_api_key()
    if not configured_key:
        log.warning("CERT_API_KEY is not set — API key auth is DISABLED (relying on Nginx proxy)")
        return
    if not hmac.compare_digest(api_key or "", configured_key):
        raise HTTPException(status_code=403, detail="Invalid API key")
