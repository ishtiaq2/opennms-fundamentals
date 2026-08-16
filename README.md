# Learning OpenNMS with Podman, PostgreSQL, a Raspberry Pi SNMP Node & Python Event Automation
### A complete, hands-on learning guide

This guide teaches **OpenNMS** from the ground up. Containers (Podman) are the delivery
mechanism, not the point most
importantly code,
runtime, libraries, config give the process its own private view of things: its own filesystem
 root, its own network interfaces, its own process-ID numbering.
- **Cgroups (control groups)** `FROM`, `RUN`,
`COPY`, `EXPOSE`, `CMD` your OpenNMS container reaches PostgreSQL simply at
the hostname `database`.

We use containers in this guide purely so OpenNMS, PostgreSQL, and the automation
script are reproducible and disposable while you learn each `podman` command runs as its own process |
| Root requirement | Traditionally root | **Rootless by default** |
| Command syntax | `docker run ...` | `podman run ...` `podman generate systemd` |
| Unique concept |          SNMP (UDP/161)
       
                                      IP: 192.168.1.50 (ex.)  
                opennms (container)   
                   :5432       
                               
                 JDBC (postgres:5432)
                               database (container)         PostgreSQL         
                               py-events (container)      Python script(s) that      send custom UEI events   
```

Two independent ways events reach OpenNMS in this guide, and you'll trace both:

1. **Real SNMP path** the Python container calls the OpenNMS REST API directly,
  bypassing SNMP entirely, to simulate "an integration told us something happened."

Having both side by side is the point: once you can trace one, you can trace the other,
and you'll see they converge on the exact same event/alarm pipeline inside OpenNMS.

---

## 6. Container 1 - OpenNMS

We use the official OpenNMS Horizon image.

```bash
mkdir -p opennms-stack && cd opennms-stack
```

`.opennms.env`:
```env
TZ=UTC
OPENNMS_DBNAME=opennms
OPENNMS_DBUSER=opennms
OPENNMS_DBPASS=opennmsPass123
```

`.postgres.env` (shared by both containers):
```env
POSTGRES_HOST=database
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgresPass123
```

Notes on the image:

- Setting `POSTGRES_HOST` controls which PostgreSQL host OpenNMS connects to, defaulting
 to a service named `database` if unset.
- The container entrypoint's `-s` flag initializes the DB if needed, applies config, and
 starts Horizon in one step.
- First boot runs schema installation it's a real (or
virtual) machine on your LAN, and it plays the role every switch, router, server, or UPS
plays in a production OpenNMS deployment: something that speaks SNMP.

### Step 1 Configure the agent

Edit `/etc/snmp/snmpd.conf`. For a lab, SNMPv2c with a community string is simplest
(SNMPv3 with auth/priv is the production-grade equivalent Sanity-check the agent *before* involving OpenNMS

This is the first manual traceability checkpoint that output *is*
raw SNMP, and Section 9 explains exactly how those dotted numbers and names relate.

### Step 4 this is your "real hardware" equivalent
of the Python container's synthetic REST event.

---

## 9. Understanding MIBs and OIDs

Before OpenNMS can turn "the Pi has an interface named eth0 that just went down" into a
readable event, two SNMP concepts have to line up: **OIDs** and **MIBs**.

### What is an OID?

An **OID (Object Identifier)** is a dotted sequence of numbers that names one specific
piece of data in a global, hierarchical tree .0 means "this scalar's single value")
```

So `1.3.6.1.2.1.1.5.0` is "the `sysName` scalar under the standard `mib-2::system`
group" it's schema, not values. `SNMPv2-MIB` (the
one that defines `sysName`, `sysUpTime`, `sysContact`, etc.) ships with every SNMP
implementation because it's a base standard; vendor-specific MIBs (Cisco, HP, APC, a UPS
vendor, etc.) are separate files you load in addition.

### How the translation actually happens

- **Without a MIB loaded**, a tool can only show you the raw numeric OID and its raw
 value no MIB translation
snmpwalk -v2c -c public -On 192.168.1.50 .1.3.6.1.2.1.1

# Symbolic names defines which OIDs get *polled on a
  schedule* and stored as performance data (interface octets, CPU load, etc.). This is
  metrics, not events.
2. **Trapd / event translation** (`${OPENNMS_HOME}/etc/trapd-configuration.xml` plus
  loaded MIBs under `${OPENNMS_HOME}/share/mibs/`) Configure SNMP MIB
Compiler in the web console, or by dropping a `.mib` file into
`${OPENNMS_HOME}/share/mibs/` and restarting Trapd), OpenNMS compiles the ASN.1 text
into its own internal event/collection definitions Quick discovery (good for a lab)

Web console Configure Discovery** **Rescan**. OpenNMS will:

1. Ping the IP.
2. If it answers, attempt SNMP against it using the community strings configured under
  **Admin Explicit requisition (closer to production practice)

**Admin create a requisition (e.g.
`lab-devices`) 
**Synchronize**. This is the repeatable, version-controllable way real deployments add
nodes instead of relying on network sweeps.

### Confirm the node is really there

```bash
curl -u admin:admin http://localhost:8980/opennms/rest/nodes?label=rpi-node-1
```

A JSON/XML body describing the node (with a numeric `id`) confirms provisioning
succeeded a
URI-shaped string like `uei.opennms.org/nodes/nodeDown`. Every event that enters
OpenNMS carries exactly one UEI.

### Events vs. Alarms

- An **event** is a single, timestamped occurrence. OpenNMS logs every event it
 receives, always.
- An **alarm** is a *deduplicated, stateful* representation of a problem, built from
 events. 500 identical "interface down" events over an hour become **one alarm** whose
 count says "500" critically your
own custom (or SNMP-trap-derived) event definitions must sit above any catch-all files
or they'll never be reached.

A minimal custom event definition:

```xml
<event>
 <uei>uei.opennms.org/custom/pythonHealthCheck/serviceDown</uei>
 <event-label>Custom: Python health-check reports service down</event-label>
 <descr>&lt;p&gt;The Python health-check script reported %parm[serviceName]% as DOWN on %nodelabel%.&lt;/p&gt;</descr>
 <logmsg dest="logndisplay">Python health check: %parm[serviceName]% is DOWN on %nodelabel%</logmsg>
 <severity>Major</severity>
 <alarm-data reduction-key="%uei%:%nodeid%:%parm[serviceName]%" alarm-type="1" auto-clean="false"/>
</event>

<event>
 <uei>uei.opennms.org/custom/pythonHealthCheck/serviceUp</uei>
 <event-label>Custom: Python health-check reports service restored</event-label>
 <descr>&lt;p&gt;The Python health-check script reported %parm[serviceName]% as UP again on %nodelabel%.&lt;/p&gt;</descr>
 <logmsg dest="logndisplay">Python health check: %parm[serviceName]% is UP on %nodelabel%</logmsg>
 <severity>Normal</severity>
 <alarm-data reduction-key="%uei%:%nodeid%:%parm[serviceName]%"
             alarm-type="2"
             clear-key="uei.opennms.org/custom/pythonHealthCheck/serviceDown:%nodeid%:%parm[serviceName]%"
             auto-clean="false"/>
</event>
```

A real SNMP-trap event definition looks the same shape, just with a UEI OpenNMS derived
from the trap's OID instead of one you invented, e.g.
`uei.opennms.org/generic/traps/EnterpriseDefault` for an unmapped vendor trap, or a
specific mapped UEI once you've defined one for the Pi's trap OID.

### Decoding `alarm-data`

- **`reduction-key`** 
 - `1` = a **problem** (something going wrong)
 - `2` = a **resolution/clear** for a matching problem alarm
 - `3` = a notification-only alarm with no associated resolution
- **`clear-key`** whether the alarm is automatically deleted (not just cleared) after
 a retention window, once resolved.

### Where custom event files go

`${OPENNMS_HOME}/etc/events/custom.events.xml`, registered near the *top* of
`eventconf.xml` with:

```xml
<event-file>events/custom.events.xml</event-file>
```

After editing, you must reload Eventd posting an event in
XML to `/rest/events` creates a corresponding event exactly as the raw XML-TCP interface
would, and that POST accepts either `application/xml` or `application/json`.

---

## 12. Container 3 - the Python Automation Container

### Project layout

```
opennms-stack/
.postgres.env
etc-overlay/
events/
custom.events.xml
Dockerfile
    send_event.py
```

`py-events/requirements.txt`:
```
requests==2.32.3
```

`py-events/Dockerfile`:
```dockerfile
FROM python:3.12-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY send_event.py .

CMD ["sleep", "infinity"]
```

`py-events/send_event.py`:
```python
"""
Sends custom OpenNMS events over the REST API (/rest/events), the same
mechanism send-event.pl uses internally -- just callable from a separate
container over plain HTTP.
"""
import sys
import requests
from requests.auth import HTTPBasicAuth

OPENNMS_URL = "http://opennms:8980/opennms/rest/events"
AUTH = HTTPBasicAuth("admin", "admin")  # change for anything beyond a lab

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


if __name__ == "__main__":
   action = sys.argv[1] if len(sys.argv) > 1 else "down"
   node_id = int(sys.argv[2]) if len(sys.argv) > 2 else 1
   service_name = sys.argv[3] if len(sys.argv) > 3 else "billing-api"

   uei = (
       "uei.opennms.org/custom/pythonHealthCheck/serviceDown"
       if action == "down"
       else "uei.opennms.org/custom/pythonHealthCheck/serviceUp"
   )
   send_event(uei, node_id, service_name)
```

`etc-overlay/events/custom.events.xml` how we inject the custom event file without building a custom OpenNMS image.
One manual step (Section 14) still registers this file in `eventconf.xml`.

---

## 13. Wiring It All Together with podman-compose

```yaml
version: "3.8"

networks:
 opennms-net:
   driver: bridge

volumes:
 psql-data:
 opennms-data:
 opennms-etc:

services:
 database:
   image: docker.io/library/postgres:14
   container_name: database
   env_file:
     - .postgres.env
   volumes:
     - psql-data:/var/lib/postgresql/data
   networks:
     - opennms-net
   healthcheck:
     test: ["CMD-SHELL", "pg_isready -U postgres"]
     interval: 10s
     timeout: 5s
     retries: 5
   ports:
     - "5432:5432"

 opennms:
   image: docker.io/opennms/horizon:latest
   container_name: opennms
   init: true
   env_file:
     - .opennms.env
     - .postgres.env
   depends_on:
     database:
       condition: service_healthy
   volumes:
     - opennms-data:/opennms-data
     - opennms-etc:/opt/opennms/etc
     - ./etc-overlay:/opt/opennms-etc-overlay
   command: ["-s"]
   networks:
     - opennms-net
   ports:
     - "8980:8980"    # web UI + REST
     - "8101:8101"    # Karaf SSH shell
     - "162:1162/udp" # SNMP trap receiver -- host 162 (privileged) mapped to
                       # an unprivileged in-container port so rootless Podman
                       # doesn't need extra capabilities; adjust trapd's
                       # listen port to match, or run rootful if you'd rather
                       # bind 162 directly.
   healthcheck:
     test: ["CMD", "curl", "-f", "-I", "http://localhost:8980/opennms/login.jsp"]
     interval: 1m
     timeout: 5s
     retries: 3

 py-events:
   build: ./py-events
   container_name: py-events
   depends_on:
     opennms:
       condition: service_healthy
   networks:
     - opennms-net
```

The Raspberry Pi is **not** in this file 
> some `podman-compose` versions ignore `condition:` and only wait for "started." Check
> `podman-compose version`, and if in doubt, poll manually:
> ```bash
> until podman exec database pg_isready -U postgres; do
>   echo "waiting for database..."
>   sleep 2
> done
> ```

---

## 14. Step-by-Step: Bring the Stack Up, Add the Pi, Trigger an Alarm

### Step 1 Confirm the web console

```bash
curl -I http://localhost:8980/opennms/login.jsp
```

Browser: `http://localhost:8980/opennms`, login `admin` / `admin`.

### Step 3 Add the Pi's SNMP community string

Web console Configure SNMP Community Names by IP** Provision the Pi (Section 10, Option A or B), then confirm

```bash
curl -u admin:admin http://localhost:8980/opennms/rest/nodes?label=rpi-node-1
```

### Step 6 a
convenient, always-available trap for testing without needing a vendor-specific MIB.)

### Step 7 See both become events/alarms

Web console Events** shows both, distinguished by source (`trapd` vs.
`py-events-container`). **Status a good
follow-up exercise once Section 15's tracing makes sense.

### Step 9 Tear down

```bash
podman-compose down
podman-compose down -v   # also removes named volumes
```

---

## 15. Tracing an Event End-to-End (Manual, Every Time)

This is the core habit this guide is trying to build: **never trust "an alarm appeared"
Real SNMP trap from the Pi

| # | Checkpoint | Command / Where | What you're confirming |
|---|---|---|---|
| 1 | Agent is alive on the Pi | `snmpwalk -v2c -c public localhost system` **on the Pi** | The agent itself answers before anything travels the network |
| 2 | Trap actually leaves the Pi | `sudo tcpdump -i any udp port 162 -n` **on the Pi**, in a second SSH session, while you run `snmptrap` | The packet is generated and sent look for a symbolic name (e.g. `NET-SNMP-MIB::netSnmpExperimental`) instead of a bare numeric OID | Confirms MIB translation happened; a bare numeric OID here means the relevant MIB isn't loaded (Section 9) |
| 6 | Trapd handed it to Eventd | `podman exec -it opennms tail -f /opt/opennms/logs/eventd.log` | Confirms the trap became a formal OpenNMS event, not just a log line |
| 7 | It matched (or didn't match) an eventconf.xml entry | Same `eventd.log` yours or the generic catch-all Events**, then **Status should now make sense given steps 1 Synthetic event from the Python container

| # | Checkpoint | Command / Where | What you're confirming |
|---|---|---|---|
| 1 | Script actually ran and got a response | Console output of `python send_event.py ...` | HTTP request left the container and OpenNMS answered (204 = accepted) |
| 2 | Request reached the REST endpoint | `podman exec -it opennms tail -f /opt/opennms/logs/manager.log` (or the Jetty access log if enabled) while re-running the script | Confirms it's not a network/DNS issue between containers on `opennms-net` |
| 3 | Eventd received it | `podman exec -it opennms tail -f /opt/opennms/logs/eventd.log` | Same checkpoint as trap Path A step 6 look for `uei.opennms.org/custom/pythonHealthCheck/serviceDown` | Confirms your `<event-file>` registration (Section 14, Step 3) is actually being read, and in the right order relative to catch-alls |
| 5 | Alarm created with the expected `reduction-key` | `curl -u admin:admin "http://localhost:8980/opennms/rest/alarms?limit=5&orderBy=lastEventTime&order=desc"` | Should show `uei.opennms.org/custom/pythonHealthCheck/serviceDown:1:billing-api` per Section 11's convention |
| 6 | "Up" event clears it, not creates a second alarm | Re-run with `up`, then re-check `/rest/alarms` | Confirms the `clear-key` on the "up" event exactly matched the "down" event's `reduction-key` Alarms**, watch the same alarm flip from Major to cleared | Final confirmation |

### Why both paths share steps 3(B)/6(A) onward

This is the payoff of building the stack this way: however an event enters OpenNMS it converges on the same Eventd optional `alarm-data` they reach each other over `localhost`, not
just a private bridge network.

```bash
podman pod create --name opennms-pod -p 8980:8980 -p 8101:8101 -p 5432:5432 -p 162:1162/udp

podman run -d --pod opennms-pod --name database \
 --env-file .postgres.env \
 -v psql-data:/var/lib/postgresql/data \
 postgres:14

podman run -d --pod opennms-pod --name opennms \
 --env-file .opennms.env --env-file .postgres.env \
 -v opennms-data:/opennms-data \
 -v ./etc-overlay:/opt/opennms-etc-overlay \
 opennms/horizon:latest -s

podman run -d --pod opennms-pod --name py-events \
 py-events:latest
```

`py-events` could then reach OpenNMS at `http://localhost:8980/opennms/rest/events`
instead of `http://opennms:8980/...`.

Export as Kubernetes YAML:
```bash
podman generate kube opennms-pod > opennms-pod.yaml
```

---

## 17. Troubleshooting

- **OpenNMS container keeps restarting / healthcheck never passes** confirm
 `depends_on: condition: service_healthy` is actually honored, not silently downgraded
 to "started."
- **`py-events` can't resolve `opennms`** most common mistake: your
 `<event-file>` reference sits *below* a catch-all tributary in `eventconf.xml`; matching
 is top-to-bottom, first match wins.
- **Changes to `eventconf.xml` don't take effect** 
 check which community string OpenNMS is configured to use for that IP (Section 14,
 Step 4); a mismatched community string looks identical to "host down" from OpenNMS's
 side.
- **Trap never shows in `trapd.log`** rootless containers
 map container UIDs into "subordinate" UID ranges on the host; check `/etc/subuid` and
 `/etc/subgid`, or prefer named volumes (as this guide does) over host bind-mounts.

---

## 18. Security Notes

- Change the default `admin/admin` OpenNMS login and default Postgres passwords before
 this touches anything beyond your lab.
- SNMPv2c community strings (like `public` used above) travel in **cleartext** and offer
 no authentication beyond "knows the string" 
 bind to `127.0.0.1:8101:8101`, etc., or drop the mapping and reach them only from other
 containers on the private network.
- Never commit real credentials in `.opennms.env`/`.postgres.env`, the Pi's community
 string, or SNMPv3 credentials to version control.
- The REST API here uses HTTP Basic Auth over plain HTTP for simplicity daemonless |
| Run without root | opt-in, less common | default behavior |
| Group of containers sharing a network namespace | not first-class | **pods** |
| Generate a systemd unit | third-party tooling | `podman generate systemd` |
| Export to Kubernetes YAML | `docker compose convert` (limited) | `podman generate kube` |

---

## 20. Roadmap & Further Reading

- Load a real vendor MIB (not just NET-SNMP-MIB's demo trap) for whatever peripheral or
 UPS you have, and define proper `alarm-data` for its trap OIDs Events & Alarms deep-dive (`docs.opennms.com`)
- OpenNMS documentation `snmpd.conf`, `snmpwalk`, `snmptrap`
- Podman documentation GitHub
- PostgreSQL documentation
