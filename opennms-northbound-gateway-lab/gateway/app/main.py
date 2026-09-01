"""
Entry point for the Northbound Gateway.

Runs two servers side by side in one process/container:
  - FastAPI/uvicorn (asyncio, main thread)   -> REST,  port settings.rest_port
  - grpc.server      (sync, background thread) -> gRPC, port settings.grpc_port

Both share the same TokenBucketLimiter class, OpenNMSClient, and
validators - the protocol is just the transport; the gateway policy
(auth, rate limiting, validation) is identical either way.
"""
import logging
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .config import settings
from .grpc_app.server import serve_grpc
from .rate_limit import TokenBucketLimiter
from .routes import router

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s"
)
logger = logging.getLogger("northbound-gateway")

rest_limiter = TokenBucketLimiter(
    max_requests=settings.rate_limit_requests,
    window_seconds=settings.rate_limit_window_seconds,
)

_UNRATED_PATHS = {"/docs", "/openapi.json", "/redoc"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    grpc_thread = threading.Thread(target=serve_grpc, daemon=True, name="grpc-server")
    grpc_thread.start()
    logger.info(
        "REST on :%s, gRPC on :%s, upstream OpenNMS at %s",
        settings.rest_port,
        settings.grpc_port,
        settings.opennms_base_url,
    )
    yield
    logger.info("shutting down")


app = FastAPI(
    title="OpenNMS Northbound Gateway",
    description=(
        "Practice lab: the Northbound module as a pure API gateway in "
        "front of OpenNMS - REST + gRPC, rate limiting, request "
        "validation. No monitoring logic lives here; it all lives in "
        "OpenNMS. This module only guards and exposes it."
    ),
    version="0.1.0",
    lifespan=lifespan,
)


@app.middleware("http")
async def rate_limit_middleware(request: Request, call_next):
    if request.url.path in _UNRATED_PATHS:
        return await call_next(request)

    client_key = request.headers.get("x-api-key") or (
        request.client.host if request.client else "anonymous"
    )
    allowed, retry_after = rest_limiter.allow(client_key)
    if not allowed:
        logger.warning("rate limit exceeded for %s on %s", client_key, request.url.path)
        return JSONResponse(
            status_code=429,
            content={"detail": "Rate limit exceeded"},
            headers={"Retry-After": str(round(retry_after, 2))},
        )
    return await call_next(request)


app.include_router(router)
