"""
gRPC server interceptors: the gRPC-side equivalent of the REST
middleware in main.py.

Gotcha this file works around: a gRPC interceptor that wants to reject
a call has to hand back a handler shaped like the *original* one
(unary_unary vs unary_stream), or the server breaks. Since this
service has both kinds (StreamEvents is server-streaming, everything
else is unary), each interceptor calls `continuation()` first to get
the real handler, checks `handler.response_streaming` to see which
shape it is, and only then builds a matching abort handler if the
call should be rejected.
"""
import grpc

from ..config import settings
from ..rate_limit import TokenBucketLimiter


def _metadata_dict(handler_call_details) -> dict:
    return dict(handler_call_details.invocation_metadata or [])


def _make_abort_handler(handler, code: grpc.StatusCode, message: str):
    if handler.response_streaming:

        def stream_abort(request, context):
            context.abort(code, message)
            yield  # pragma: no cover - unreachable, abort() raises

        return grpc.unary_stream_rpc_method_handler(
            stream_abort,
            request_deserializer=handler.request_deserializer,
            response_serializer=handler.response_serializer,
        )

    def unary_abort(request, context):
        context.abort(code, message)

    return grpc.unary_unary_rpc_method_handler(
        unary_abort,
        request_deserializer=handler.request_deserializer,
        response_serializer=handler.response_serializer,
    )


class ApiKeyInterceptor(grpc.ServerInterceptor):
    """Checks the `x-api-key` metadata entry against settings.api_keys."""

    def intercept_service(self, continuation, handler_call_details):
        handler = continuation(handler_call_details)
        if handler is None:
            return handler

        api_key = _metadata_dict(handler_call_details).get("x-api-key")
        if api_key in settings.api_keys:
            return handler

        return _make_abort_handler(
            handler,
            grpc.StatusCode.UNAUTHENTICATED,
            "Missing or invalid x-api-key metadata",
        )


class RateLimitInterceptor(grpc.ServerInterceptor):
    """Same TokenBucketLimiter class the REST middleware uses, keyed by
    the same `x-api-key` value, so REST and gRPC calls from the same
    client share one rate-limit identity - not one limit per protocol."""

    def __init__(self, limiter: TokenBucketLimiter):
        self._limiter = limiter

    def intercept_service(self, continuation, handler_call_details):
        handler = continuation(handler_call_details)
        if handler is None:
            return handler

        client_key = _metadata_dict(handler_call_details).get("x-api-key", "anonymous")
        allowed, retry_after = self._limiter.allow(client_key)
        if allowed:
            return handler

        return _make_abort_handler(
            handler,
            grpc.StatusCode.RESOURCE_EXHAUSTED,
            f"Rate limit exceeded, retry after {retry_after:.1f}s",
        )
