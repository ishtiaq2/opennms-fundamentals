"""
A tiny stand-in for OpenNMS's ReST API - just enough of the shapes the
gateway expects (/opennms/rest/info, /nodes, /alarms, /events,
/northbound/...) to practice the gateway's REST/gRPC, rate-limiting,
and validation behavior without needing a real OpenNMS instance
reachable.

This is NOT part of the "core" lab - it's an optional convenience for
practicing away from your real OpenNMS box (e.g. on a laptop off the
LAN). Your actual 192.168.1.122:8980 instance is the real target; see
GUIDE.md Part 4.

Run directly:
    uvicorn app:app --app-dir mock-backend --port 8980
or via podman-compose (see opennms-backend/, "mock" profile note in
GUIDE.md Part 4b).
"""
from fastapi import FastAPI

app = FastAPI(title="Fake OpenNMS ReST API")

_NODES = [
    {"id": 1, "label": "core-switch-01", "sysObjectId": ".1.3.6.1.4.1.9.1.1208", "type": "A"},
    {"id": 2, "label": "raspberrypi-lab", "sysObjectId": ".1.3.6.1.4.1.8072.3.2.10", "type": "A"},
    {"id": 3, "label": "office-ap-01", "sysObjectId": ".1.3.6.1.4.1.14988.1", "type": "A"},
]

_ALARMS = [
    {"id": 101, "uei": "uei.opennms.org/nodes/nodeDown", "severity": "CRITICAL",
     "logMsg": "Node raspberrypi-lab is down", "nodeId": 2},
    {"id": 102, "uei": "uei.opennms.org/nodes/nodeUp", "severity": "CLEARED",
     "logMsg": "Node core-switch-01 is up", "nodeId": 1},
    {"id": 103, "uei": "uei.opennms.org/threshold/highThresholdExceeded", "severity": "WARNING",
     "logMsg": "High CPU on office-ap-01", "nodeId": 3},
]

_EVENTS = [
    {"id": 5001, "uei": "uei.opennms.org/nodes/nodeDown", "logMsg": "Node down: raspberrypi-lab"},
    {"id": 5002, "uei": "uei.opennms.org/nodes/nodeUp", "logMsg": "Node up: core-switch-01"},
]


@app.get("/opennms/rest/info")
def info():
    return {"displayVersion": "33.0.0-fake", "packageName": "opennms"}


@app.get("/opennms/rest/nodes/{node_id}")
def get_node(node_id: int):
    for n in _NODES:
        if n["id"] == node_id:
            return n
    return {"id": node_id, "label": None, "sysObjectId": None, "type": "D"}


@app.get("/opennms/rest/nodes")
def list_nodes(limit: int = 20, offset: int = 0):
    page = _NODES[offset : offset + limit]
    return {"node": page, "count": len(page), "totalCount": len(_NODES)}


@app.get("/opennms/rest/alarms")
def list_alarms(severity: str | None = None, limit: int = 20):
    results = _ALARMS
    if severity:
        results = [a for a in results if a["severity"] == severity]
    return {"alarm": results[:limit], "count": len(results[:limit]), "totalCount": len(results)}


@app.get("/opennms/rest/events")
def list_events(limit: int = 20):
    return {"event": _EVENTS[:limit], "count": len(_EVENTS[:limit]), "totalCount": len(_EVENTS)}


@app.get("/opennms/rest/northbound/{subpath:path}")
def northbound_plugin(subpath: str = ""):
    return {"plugin": "northbound", "subpath": subpath, "note": "stand-in for your custom plugin"}
