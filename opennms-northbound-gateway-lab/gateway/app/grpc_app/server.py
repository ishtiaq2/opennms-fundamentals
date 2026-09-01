from concurrent import futures

import grpc

from ..config import settings
from ..rate_limit import TokenBucketLimiter
from . import northbound_pb2_grpc
from .interceptors import ApiKeyInterceptor, RateLimitInterceptor
from .servicer import NorthboundServicer


def serve_grpc() -> None:
    # A second limiter instance, deliberately: it enforces the same
    # policy (same requests/window from settings) as the REST side, but
    # gRPC and REST clients are rate-limited independently of each
    # other by default. If you want one shared limit across both
    # protocols for the same API key, pass a single TokenBucketLimiter
    # instance into both main.py and here - see GUIDE.md Part 6.
    limiter = TokenBucketLimiter(
        max_requests=settings.rate_limit_requests,
        window_seconds=settings.rate_limit_window_seconds,
    )

    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=10),
        interceptors=[ApiKeyInterceptor(), RateLimitInterceptor(limiter)],
    )
    northbound_pb2_grpc.add_NorthboundGatewayServicer_to_server(NorthboundServicer(), server)
    server.add_insecure_port(f"[::]:{settings.grpc_port}")
    server.start()
    server.wait_for_termination()


if __name__ == "__main__":
    serve_grpc()
