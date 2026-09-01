"""
Gateway-facing authentication.

Note the split: external clients authenticate to *this gateway* with a
simple API key (X-API-Key header). The gateway then authenticates to
*OpenNMS* separately, using the HTTP Basic service-account credentials
in config.py. Clients never see or hold the OpenNMS admin password -
that's a real API-gateway responsibility, not just a REST/gRPC detail.
"""
from fastapi import Header, HTTPException, status

from .config import settings


async def require_api_key(x_api_key: str | None = Header(default=None)) -> str:
    if not x_api_key or x_api_key not in settings.api_keys:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-API-Key header",
        )
    return x_api_key
