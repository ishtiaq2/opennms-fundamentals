#!/usr/bin/env bash
# Regenerate the gRPC Python stubs from northbound.proto.
#
# Run this from anywhere - it cd's into its own directory first.
#
# Gotcha this script works around: protoc's Python plugin generates
# `northbound_pb2_grpc.py` with a flat `import northbound_pb2 as ...`
# line. That's fine as a standalone script, but breaks the moment these
# files live inside a package (gateway.app.grpc_app), because Python
# won't find a top-level `northbound_pb2` module. The sed step below
# rewrites it to a relative import so it works both inside the app
# package and when this directory is added to sys.path directly (see
# clients/grpc_client_example.py).
set -euo pipefail
cd "$(dirname "$0")"

python3 -m grpc_tools.protoc \
  -I. \
  --python_out=. \
  --grpc_python_out=. \
  --pyi_out=. \
  northbound.proto

sed -i 's/^import northbound_pb2 as northbound__pb2/from . import northbound_pb2 as northbound__pb2/' northbound_pb2_grpc.py

echo "Generated northbound_pb2.py, northbound_pb2_grpc.py, northbound_pb2.pyi"
