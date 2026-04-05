"""API key authentication utilities."""

import hmac

from fastapi import HTTPException, Request, Security
from fastapi.security import APIKeyHeader

from app.config import API_KEY
from app.utils.logging import log

api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)

if not API_KEY:
    log.warning("CERT_API_KEY is not set — API key auth is DISABLED (relying on Nginx proxy)")


async def verify_api_key(request: Request, api_key: str = Security(api_key_header)) -> None:
    """Verify API key from X-API-Key header.

    Skips verification for /api/health. Warns at startup if CERT_API_KEY is not set.

    Args:
        request: Incoming HTTP request.
        api_key: Value from X-API-Key header.

    Raises:
        HTTPException: 403 if API key is configured and the provided key is invalid.
    """
    if request.url.path == "/api/health":
        return
    if API_KEY and not hmac.compare_digest(api_key or "", API_KEY):
        raise HTTPException(status_code=403, detail="Invalid API key")
