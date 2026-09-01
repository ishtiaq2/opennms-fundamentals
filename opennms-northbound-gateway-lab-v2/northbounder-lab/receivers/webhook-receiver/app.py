"""
Minimal webhook receiver - stands in for an external ticketing system
(ServiceNow, Jira) or a Manager-of-Managers dashboard's inbound
webhook endpoint.

OpenNMS doesn't ship a stock "HTTP Northbounder" config file the way
it does for Syslog/SNMP Trap (see GUIDE.md Part 11 for what was and
wasn't verifiable there), so this is fed by a small BeanShell script
running inside OpenNMS's BSF Northbounder - see
northbounder-lab/opennms-northbound-configs/bsf-northbounder-configuration.xml.
Keeps an in-memory log so you can see exactly what arrived and when.
"""
from datetime import datetime, timezone

from fastapi import FastAPI, Request

app = FastAPI(title="Webhook Receiver (stand-in for an external ticketing/MoM system)")

_received: list[dict] = []


@app.post("/opennms/alarm")
async def receive_alarm(request: Request):
    body = await request.json()
    entry = {"received_at": datetime.now(timezone.utc).isoformat(), "body": body}
    _received.append(entry)
    print(f"[webhook-receiver] alarm received: {body}")
    return {"status": "accepted", "count": len(_received)}


@app.get("/received")
async def list_received():
    """Not part of the northbounder flow - just lets you check what's
    arrived so far without tailing logs."""
    return {"count": len(_received), "alarms": _received}


@app.get("/health")
async def health():
    return {"status": "ok"}
