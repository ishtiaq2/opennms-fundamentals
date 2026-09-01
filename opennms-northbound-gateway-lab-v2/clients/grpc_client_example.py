"""
Quick gRPC client example against the Northbound Gateway.

Usage:
    GATEWAY_API_KEY=test-key-123 python3 clients/grpc_client_example.py
"""
import os
import sys

# The generated stubs (northbound_pb2_grpc.py) import their sibling
# module with a relative `from . import northbound_pb2` (see
# generate.sh), which only works when they're loaded as part of the
# `app.grpc_app` package - the same way the server itself loads them.
# So we add the `gateway/` directory to sys.path (making `app`
# importable as a top-level package) rather than importing the two
# generated files directly as flat modules.
_GATEWAY_DIR = os.path.join(os.path.dirname(__file__), "..", "gateway")
sys.path.insert(0, os.path.abspath(_GATEWAY_DIR))

import grpc
from app.grpc_app import northbound_pb2, northbound_pb2_grpc

HOST = os.getenv("GATEWAY_GRPC_HOST", "localhost:50051")
API_KEY = os.getenv("GATEWAY_API_KEY", "demo-key-123")
METADATA = [("x-api-key", API_KEY)]


def main():
    channel = grpc.insecure_channel(HOST)
    stub = northbound_pb2_grpc.NorthboundGatewayStub(channel)

    print("== HealthCheck ==")
    print(stub.HealthCheck(northbound_pb2.HealthCheckRequest(), metadata=METADATA))

    print("== ListNodes (limit=5) ==")
    print(stub.ListNodes(northbound_pb2.ListNodesRequest(limit=5), metadata=METADATA))

    print("== GetNode (node_id=2) ==")
    print(stub.GetNode(northbound_pb2.GetNodeRequest(node_id=2), metadata=METADATA))

    print("== ListAlarms (severity=CRITICAL) ==")
    print(stub.ListAlarms(
        northbound_pb2.ListAlarmsRequest(severity="CRITICAL", limit=5), metadata=METADATA
    ))

    print("== StreamEvents (poll_interval_seconds=2, Ctrl+C to stop) ==")
    try:
        for event in stub.StreamEvents(
            northbound_pb2.StreamEventsRequest(poll_interval_seconds=2), metadata=METADATA
        ):
            print(event)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
