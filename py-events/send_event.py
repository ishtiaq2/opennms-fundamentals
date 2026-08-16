"""
Sends custom OpenNMS events over the REST API (/rest/events), the same
mechanism send-event.pl uses internally -- just callable from a separate
container over plain HTTP.

Configuration is read from environment variables (see .env / Dockerfile):
    OPENNMS_URL   -- full URL to the events REST endpoint
    OPENNMS_USER  -- basic auth username
    OPENNMS_PASS  -- basic auth password
"""
import os
import sys

import requests
from requests.auth import HTTPBasicAuth

OPENNMS_URL = os.environ.get(
    "OPENNMS_URL", "http://opennms:8980/opennms/rest/events"
)
OPENNMS_USER = os.environ.get("OPENNMS_USER", "admin")
OPENNMS_PASS = os.environ.get("OPENNMS_PASS", "admin")  # change for anything beyond a lab
AUTH = HTTPBasicAuth(OPENNMS_USER, OPENNMS_PASS)

EVENT_XML_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<event xmlns="http://xmlns.opennms.org/xsd/event">
    <uei>{uei}</uei>
    <source>py-events-container</source>
    <nodeid>{node_id}</nodeid>
    <parms>
        <parm>
            <parmName>serviceName</parmName>
            <value type="string" encoding="text">{service_name}</value>
        </parm>
    </parms>
</event>"""


def send_event(uei: str, node_id: int, service_name: str) -> None:
    payload = EVENT_XML_TEMPLATE.format(uei=uei, node_id=node_id, service_name=service_name)
    headers = {"Content-Type": "application/xml"}

    response = requests.post(OPENNMS_URL, data=payload, headers=headers, auth=AUTH)

    if response.status_code in (200, 204):
        print(f"Sent {uei} for service='{service_name}' on node {node_id} -- status {response.status_code}")
    else:
        print(f"Failed to send event: {response.status_code} {response.text}")
        sys.exit(1)


def usage_and_exit() -> None:
    print("Usage: python send_event.py [down|up] [node_id] [service_name]")
    print("  down|up      Event direction (default: down)")
    print("  node_id      Numeric OpenNMS node id (default: 1)")
    print("  service_name Free-text service label (default: billing-api)")
    sys.exit(1)


if __name__ == "__main__":
    action = sys.argv[1] if len(sys.argv) > 1 else "down"
    if action not in ("down", "up"):
        usage_and_exit()

    try:
        node_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    except ValueError:
        usage_and_exit()

    service_name = sys.argv[3] if len(sys.argv) > 3 else "billing-api"

    uei = (
        "uei.opennms.org/custom/pythonHealthCheck/serviceDown"
        if action == "down"
        else "uei.opennms.org/custom/pythonHealthCheck/serviceUp"
    )
    send_event(uei, node_id, service_name)
