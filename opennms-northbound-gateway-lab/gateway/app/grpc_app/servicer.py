"""
gRPC service implementation.

Deliberately calls the *same* opennms_client and validators the REST
routes use (see gateway/app/routes.py) - the point of this lab is that
REST and gRPC are two thin adapters in front of one gateway policy,
not two separate gateways that happen to share a name.

grpc's sync server runs each handler in a worker thread (not asyncio),
so async opennms_client calls are driven with asyncio.run() per call -
simple and correct for a lab's request volume. A production build
would more likely use grpc.aio instead; see GUIDE.md Part 9.
"""
import asyncio
import datetime
import time

import grpc

from ..opennms_client import opennms_client
from ..validators import ValidationError, validate_limit, validate_node_id, validate_severity
from . import northbound_pb2, northbound_pb2_grpc

# Demo-friendly cap so StreamEvents doesn't run forever if a client
# forgets to disconnect - a real deployment would stream indefinitely.
_MAX_STREAM_POLLS = 20


class NorthboundServicer(northbound_pb2_grpc.NorthboundGatewayServicer):
    def HealthCheck(self, request, context):
        result = asyncio.run(opennms_client.health())
        return northbound_pb2.HealthCheckResponse(
            status=result["status"], backend=result["backend"]
        )

    def GetNode(self, request, context):
        try:
            node_id = validate_node_id(request.node_id)
        except ValidationError as e:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return northbound_pb2.NodeResponse()

        try:
            data = asyncio.run(opennms_client.get_node(node_id))
        except Exception as e:
            context.abort(grpc.StatusCode.UNAVAILABLE, f"OpenNMS lookup failed: {e}")
            return northbound_pb2.NodeResponse()

        return northbound_pb2.NodeResponse(
            node_id=node_id,
            label=data.get("label") or "",
            sys_object_id=data.get("sysObjectId") or "",
            provisioned=data.get("type", "A") != "D",
        )

    def ListNodes(self, request, context):
        try:
            limit = validate_limit(request.limit or 20)
        except ValidationError as e:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return northbound_pb2.ListNodesResponse()

        try:
            data = asyncio.run(
                opennms_client.list_nodes(limit=limit, offset=request.offset or 0)
            )
        except Exception as e:
            context.abort(grpc.StatusCode.UNAVAILABLE, f"OpenNMS lookup failed: {e}")
            return northbound_pb2.ListNodesResponse()

        nodes = data.get("node", [])
        if isinstance(nodes, dict):
            nodes = [nodes]

        return northbound_pb2.ListNodesResponse(
            nodes=[
                northbound_pb2.NodeResponse(
                    node_id=int(n.get("id", 0)),
                    label=n.get("label") or "",
                    sys_object_id=n.get("sysObjectId") or "",
                    provisioned=n.get("type", "A") != "D",
                )
                for n in nodes
            ],
            total=int(data.get("totalCount", len(nodes))),
        )

    def ListAlarms(self, request, context):
        try:
            severity = validate_severity(request.severity or None)
            limit = validate_limit(request.limit or 20)
        except ValidationError as e:
            context.abort(grpc.StatusCode.INVALID_ARGUMENT, str(e))
            return northbound_pb2.ListAlarmsResponse()

        try:
            data = asyncio.run(opennms_client.list_alarms(severity=severity, limit=limit))
        except Exception as e:
            context.abort(grpc.StatusCode.UNAVAILABLE, f"OpenNMS lookup failed: {e}")
            return northbound_pb2.ListAlarmsResponse()

        alarms = data.get("alarm", [])
        if isinstance(alarms, dict):
            alarms = [alarms]

        return northbound_pb2.ListAlarmsResponse(
            alarms=[
                northbound_pb2.Alarm(
                    alarm_id=int(a.get("id", 0)),
                    uei=a.get("uei") or "",
                    severity=a.get("severity") or "",
                    log_msg=a.get("logMsg") or "",
                    node_id=int(a.get("nodeId") or 0),
                )
                for a in alarms
            ]
        )

    def StreamEvents(self, request, context):
        interval = request.poll_interval_seconds or 5
        seen_ids: set[int] = set()

        for _ in range(_MAX_STREAM_POLLS):
            if not context.is_active():
                return

            try:
                data = asyncio.run(opennms_client.list_events(limit=10))
            except Exception as e:
                context.abort(grpc.StatusCode.UNAVAILABLE, f"OpenNMS lookup failed: {e}")
                return

            events = data.get("event", [])
            if isinstance(events, dict):
                events = [events]

            for e in events:
                event_id = int(e.get("id", 0))
                if event_id in seen_ids:
                    continue
                seen_ids.add(event_id)
                yield northbound_pb2.EventMessage(
                    event_id=event_id,
                    uei=e.get("uei") or "",
                    description=(e.get("logMsg") or "")[:500],
                    timestamp=datetime.datetime.now(datetime.timezone.utc).isoformat(),
                )

            time.sleep(interval)
