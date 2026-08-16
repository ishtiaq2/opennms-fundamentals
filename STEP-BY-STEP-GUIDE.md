# Step-by-Step: OpenNMS Learning Lab

This is the corrected, complete, ordered walkthrough for the stack described in the
main [README](../README.md). Every step below is meant to be run in order the first
time through — later sections point back to earlier ones instead of repeating setup.

---

## Part 1 — Understand the pieces before you build

### 1.1 What a container actually is

A container packages an application with everything it needs to run — code, runtime,
libraries, config — as one isolated, portable unit. It is **not** a lightweight virtual
machine; there's no separate guest kernel. It's a normal process on the host, made to
*look* isolated using two Linux kernel features:

- **Namespaces** — give the process its own private view of things: its own filesystem
  root, its own network interfaces, its own process-ID numbering.
- **Cgroups (control groups)** — limit and account for the CPU/memory the process may
  consume.

A **Containerfile** (Podman's name for a Dockerfile) is a text recipe — `FROM`, `RUN`,
`COPY`, `EXPOSE`, `CMD` — built top to bottom into an **image**: a read-only, layered
snapshot of everything needed to run the app. A **container** is a running instance of
that image.

**Compose** (`podman-compose`) lets you describe multiple services, networks, and
volumes declaratively in one YAML file, and sets up a private network so containers
reach each other by service name — your OpenNMS container reaches PostgreSQL simply at
the hostname `database`.

We use containers here purely so OpenNMS, PostgreSQL, and the automation script are
reproducible and disposable while you learn. The Raspberry Pi is real hardware, not a
container — it plays the role every switch, router, server, or UPS plays in a real
OpenNMS deployment: something that speaks SNMP.

### 1.2 Docker vs. Podman, in one table

| | Docker | Podman |
|---|---|---|
| Architecture | Client talks to a long-running background **daemon** (`dockerd`) | **Daemonless** — each `podman` command runs as its own process |
| Root requirement | Traditionally root | **Rootless by default** |
| Command syntax | `docker run ...` | `podman run ...` (near drop-in) |
| Multi-container tooling | `docker compose` | `podman-compose` (reads the same YAML) |
| Systemd integration | Bolted on | First-class — `podman generate systemd` |
| Unique concept | — | **Pods** — containers sharing one network namespace |

Because Podman is rootless and daemonless, nothing in this guide needs `sudo`.

### 1.3 The architecture

```
                                    SNMP (UDP/161 poll, UDP/162 traps)
      ┌────────────────────────┐  ◄──────────────────────────┐
      │  Raspberry Pi (real HW) │                             │
      │  net-snmp agent         │                             │
      │  e.g. 192.168.1.50      │                             │
      └────────────────────────┘                             │
                                                    ┌───────────────────┐
                                                    │ opennms (container)│
                                                    │ Horizon core + UI  │
                                                    │ :8980  :8101  :162 │
                                                    └──────────┬─────────┘
                                                                │ JDBC :5432
                                                                ▼
                                                    ┌───────────────────┐
                                                    │ database (container)│
                                                    │ PostgreSQL          │
                                                    └───────────────────┘
                                                                ▲
                                                    REST API :8980/rest/events
                                                    ┌──────────┴─────────┐
                                                    │ py-events (container)│
                                                    │ sends custom UEI     │
                                                    │ events over REST     │
                                                    └───────────────────┘
```

Two independent paths generate events, and you'll trace both in Part 6:

1. **Real SNMP path** — the Pi sends an SNMP trap; OpenNMS's Trapd receives and
   translates it via loaded MIBs; Eventd matches it against `eventconf.xml`.
2. **Synthetic REST path** — the Python container POSTs an event directly to
   `/rest/events`, simulating an external integration, bypassing SNMP entirely.

Both converge on the same Eventd → `eventconf.xml` → optional `alarm-data` → alarm
pipeline.

---

## Part 2 — Install and verify Podman

**Fedora/RHEL/CentOS:**
```bash
sudo dnf install -y podman
```

**Debian/Ubuntu:**
```bash
sudo apt-get update
sudo apt-get install -y podman
```

**macOS/Windows** (needs a Linux VM under the hood):
```bash
brew install podman
podman machine init
podman machine start
```

**`podman-compose`:**
```bash
pip install podman-compose --break-system-packages
```

Verify:
```bash
podman --version
podman info
podman-compose version
```

Optional warm-up (confirms rootless networking works before you rely on it):
```bash
podman run -d --name web-test -p 8888:80 docker.io/library/nginx:alpine
curl -I http://localhost:8888
podman stop web-test && podman rm web-test
```

---

## Part 3 — Set up the Raspberry Pi as an SNMP node

The Pi is real hardware on your LAN, not part of the compose stack.

### Step 1 — Install an SNMP agent on the Pi

SSH into the Pi:
```bash
sudo apt-get update
sudo apt-get install -y snmpd snmp-mibs-downloader snmp
```
(`snmp` gives you the client tools — `snmpwalk`, `snmptrap` — you'll use for testing.)

### Step 2 — Configure the agent

Edit `/etc/snmp/snmpd.conf`. SNMPv2c with a community string is simplest for a lab
(SNMPv3 with auth/privacy is the production-grade equivalent — see Part 7):

```conf
# Listen on all interfaces, standard port
agentAddress udp:161

# Read-only community string, restricted to your management subnet
rocommunity public 192.168.1.0/24

# Basic system identity so OpenNMS has something readable to show
sysLocation    "Home lab, learning rack"
sysContact     "you@example.com"
sysName        rpi-node-1
```

Restart and enable the agent:
```bash
sudo systemctl restart snmpd
sudo systemctl enable snmpd
```

### Step 3 — Sanity-check the agent before involving OpenNMS

This is your first manual traceability checkpoint — always confirm the agent answers
before blaming OpenNMS for a "down" node. From the Pi itself:
```bash
snmpwalk -v2c -c public localhost system
```
You should see several lines like `SNMPv2-MIB::sysName.0 = STRING: rpi-node-1`. That
symbolic output *is* MIB translation happening — see Part 4.

Then confirm it's reachable from wherever OpenNMS will run (e.g. your workstation or
the container host):
```bash
snmpwalk -v2c -c public <pi-ip> system
```

### Step 4 — Confirm trap tooling works

You already installed `snmp` (the client package) in Step 1, which provides
`snmptrap`. You'll use it in Part 5 to fire a real trap toward OpenNMS — this is your
"real hardware" equivalent of the Python container's synthetic REST event.

---

## Part 4 — Understand MIBs and OIDs

Before OpenNMS can turn "the Pi's interface just went down" into a readable event, two
SNMP concepts have to line up: **OIDs** and **MIBs**.

### What is an OID?

An **OID (Object Identifier)** is a dotted sequence of numbers naming one specific piece
of data in a global, hierarchical tree every SNMP device shares. Example:

```
1.3.6.1.2.1.1.5.0
```

Read left to right:
```
1     iso
 .3    org
   .6    dod
     .1    internet
       .2    mgmt
         .1    mib-2
           .1    system
             .5    sysName
               .0    (the "instance" -- .0 means "this scalar's single value")
```

So `1.3.6.1.2.1.1.5.0` is "the `sysName` scalar under the standard `mib-2::system`
group" — on the Pi, that resolves to `rpi-node-1`. Vendor-specific branches live under
`1.3.6.1.4.1.<enterprise-number>`.

### What is a MIB?

A **MIB (Management Information Base)** is a text file, written in ASN.1, that acts as a
dictionary between the numeric OID tree and human-readable names, types, and
descriptions. It's schema, not live values. `SNMPv2-MIB` ships with every SNMP
implementation as a base standard; vendor MIBs (Cisco, HP, APC, etc.) are separate files
loaded in addition.

### How the translation actually happens

Without a MIB loaded, a tool can only show the raw numeric OID and value:
```bash
snmpwalk -v2c -c public -On 192.168.1.50 .1.3.6.1.2.1.1
```
With the MIB loaded, the same tool resolves the numeric prefix to symbolic names:
```bash
snmpwalk -v2c -c public 192.168.1.50 system
```

### How OpenNMS specifically uses this

OpenNMS uses compiled MIB definitions in two different subsystems — knowing which is
which matters when tracing events in Part 6:

1. **Collectd / SNMP data collection**
   (`${OPENNMS_HOME}/etc/datacollection-config.xml` and its tributaries) — defines which
   OIDs get *polled on a schedule* and stored as performance data (interface octets, CPU
   load, etc.). This is metrics, not events.
2. **Trapd / event translation**
   (`${OPENNMS_HOME}/etc/trapd-configuration.xml` plus MIBs loaded under
   `${OPENNMS_HOME}/share/mibs/`) — when a trap arrives, Trapd looks up its OID against
   loaded MIBs to find a human label, then hands it to Eventd for `eventconf.xml`
   matching (same pipeline as any other event).

To load a vendor MIB: **Admin → Configure SNMP MIB Compiler** in the web console, or
drop a `.mib` file into `${OPENNMS_HOME}/share/mibs/` and restart Trapd. OpenNMS
compiles the ASN.1 text into its own internal event/collection definitions.

---

## Part 5 — Build and start the stack

### Step 1 — Clone this repo and enter the stack directory

```bash
git clone <your-repo-url>
cd opennms-learning-repo/opennms-stack
```

The env files (`.opennms.env`, `.postgres.env`) and `podman-compose.yml` are already
provided. Review them and change the placeholder passwords before doing anything beyond
a local lab.

### Step 2 — Bring the stack up

```bash
podman-compose up -d
podman-compose logs -f opennms
```

First boot runs OpenNMS's schema installation against PostgreSQL — this takes a couple
of minutes. Don't panic if `:8980` isn't answering immediately.

### Step 3 — Confirm the web console

```bash
curl -I http://localhost:8980/opennms/login.jsp
```
Or open `http://localhost:8980/opennms` in a browser — login `admin` / `admin` (you'll
be prompted to change it).

### Step 4 — Register the custom event file

The `etc-overlay/` directory is bind-mounted into the container and layered onto
`/opt/opennms/etc`, but `eventconf.xml` still needs one line added to actually load it:

```bash
podman exec -it opennms bash
```
Inside the container:
```bash
cd /opt/opennms/etc
sed -i '/<\/events>/i\  <event-file>events/custom.events.xml</event-file>' eventconf.xml
./bin/send-event.pl uei.opennms.org/internal/reloadDaemonConfig -p 'daemonName Eventd'
exit
```
That `send-event.pl` call reloads Eventd's config without restarting the whole
container — the exact tool it's designed for.

### Step 5 — Add the Pi's SNMP community string to OpenNMS

Web console → **Admin → Configure SNMP Community Names by IP** → add the Pi's IP with
the `public` community string from Part 3.

### Step 6 — Provision the Pi as a node

**Option A — Quick discovery (good for a lab):**
Web console → **Admin → Configure Discovery** → add the Pi's IP (or a small CIDR range
covering it) → **Rescan**. OpenNMS will ping the IP, then attempt SNMP using the
community string from Step 5, and if it answers, create a node and read
`sysName`/`sysObjectID` to label it.

**Option B — Explicit requisition (closer to production practice):**
Web console → **Admin → Manage Provisioning Requisitions** → create a requisition
(e.g. `lab-devices`) → add a node manually with the Pi's IP interface, mark it
SNMP-primary → **Synchronize**. This is the repeatable, version-controllable way real
deployments add nodes instead of relying on network sweeps.

### Step 7 — Confirm the node exists

```bash
curl -u admin:admin "http://localhost:8980/opennms/rest/nodes?label=rpi-node-1"
```
A JSON/XML body with a numeric `id` confirms provisioning succeeded. Note that `id` —
you'll need it to correlate events back to this node.

---

## Part 6 — Trigger and trace an event, end to end

### Step 1 — Fire a real trap from the Pi

From the Pi:
```bash
snmptrap -v2c -c public <opennms-host-ip>:162 '' 1.3.6.1.4.1.8072.2.3.0.1 \
  1.3.6.1.2.1.1.1.0 s "Manual test trap from rpi-node-1"
```
`1.3.6.1.4.1.8072.2.3.0.1` is the net-snmp demo trap OID under `NET-SNMP-MIB` — a
convenient, always-available trap for testing without a vendor-specific MIB.

### Step 2 — Fire the synthetic Python event

```bash
podman exec -it py-events python send_event.py down 1 billing-api
```
Expected output:
```
Sent uei.opennms.org/custom/pythonHealthCheck/serviceDown for service='billing-api' on node 1 -- status 204
```
(If your Pi's node `id` from Part 5, Step 7 isn't `1`, pass that number instead.)

### Step 3 — See both on the console

Web console → **Status → Events** shows both, distinguished by source (`trapd` vs.
`py-events-container`). **Status → Alarms** shows the Python one as a Major alarm (it
has `alarm-data`); the raw test trap shows only as an event unless you've defined
`alarm-data` for that trap OID in a custom event file — a good follow-up exercise.

### Step 4 — Trace the SNMP trap manually, checkpoint by checkpoint

| # | Checkpoint | Command / Where | What it confirms |
|---|---|---|---|
| 1 | Agent is alive on the Pi | `snmpwalk -v2c -c public localhost system` **on the Pi** | Agent answers before anything travels the network |
| 2 | Trap leaves the Pi | `sudo tcpdump -i any udp port 162 -n` **on the Pi**, in a second SSH session, while running `snmptrap` | Packet is generated and sent — rules out a silently-failed command |
| 3 | Trap arrives at the OpenNMS host | `sudo tcpdump -i any udp port 162 -n` **on the OpenNMS container's host** | Rules out routing/firewall issues between Pi and OpenNMS host |
| 4 | Trapd received and logged it | `podman exec -it opennms tail -f /opt/opennms/logs/trapd.log` | Trapd's listener picked it up |
| 5 | OID was translated via loaded MIBs | Same `trapd.log` line — look for a symbolic name (e.g. `NET-SNMP-MIB::netSnmpExperimental`) instead of a bare numeric OID | MIB translation happened; a bare numeric OID means the MIB isn't loaded (Part 4) |
| 6 | Trapd handed it to Eventd | `podman exec -it opennms tail -f /opt/opennms/logs/eventd.log` | The trap became a formal OpenNMS event |
| 7 | It matched (or didn't match) an `eventconf.xml` entry | Same `eventd.log` — a matched event shows a mapped UEI; unmatched shows `.../traps/EnterpriseDefault` | Which definition claimed it, and therefore whether `alarm-data` applied |
| 8 | Event is queryable via REST | `curl -u admin:admin "http://localhost:8980/opennms/rest/events?limit=5&orderBy=id&order=desc"` | It's persisted in PostgreSQL, independent of the UI |
| 9 | Alarm exists (only if the matched definition had `alarm-data`) | `curl -u admin:admin "http://localhost:8980/opennms/rest/alarms?limit=5&orderBy=lastEventTime&order=desc"` | Dedup/state logic ran; compare the `reduction-key` against Part 4's/Part 7's rules |
| 10 | Visible on the console | **Status → Events**, then **Status → Alarms** | Final human-facing confirmation |

### Step 5 — Trace the synthetic Python event manually

| # | Checkpoint | Command / Where | What it confirms |
|---|---|---|---|
| 1 | Script ran and got a response | Console output of `python send_event.py ...` | HTTP request left the container and OpenNMS answered (204 = accepted) |
| 2 | Request reached the REST endpoint | `podman exec -it opennms tail -f /opt/opennms/logs/manager.log` while re-running the script | Not a network/DNS issue between containers on `opennms-net` |
| 3 | Eventd received it | `podman exec -it opennms tail -f /opt/opennms/logs/eventd.log` | Same pipeline as trap checkpoint 6 — REST events join it here |
| 4 | It matched `custom.events.xml` | Same log — look for `uei.opennms.org/custom/pythonHealthCheck/serviceDown` | Your `<event-file>` registration (Part 5, Step 4) is being read, in the right order relative to catch-alls |
| 5 | Alarm created with the expected `reduction-key` | `curl -u admin:admin "http://localhost:8980/opennms/rest/alarms?limit=5&orderBy=lastEventTime&order=desc"` | Should show `uei.opennms.org/custom/pythonHealthCheck/serviceDown:1:billing-api` |
| 6 | "Up" event clears it instead of creating a second alarm | Run `podman exec -it py-events python send_event.py up 1 billing-api`, then re-check `/rest/alarms` | The `clear-key` on the "up" event exactly matched the "down" event's `reduction-key` — a single mismatched character creates a second, unrelated alarm instead |
| 7 | Visible on the console | **Status → Alarms** — watch it flip from Major to cleared | Final confirmation |

However an event enters OpenNMS — trap, poller, REST, or `send-event.pl` — it converges
on the same Eventd → `eventconf.xml` matching → optional `alarm-data` → alarm pipeline.
Once you can read `eventd.log` and query `/rest/events`/`/rest/alarms` confidently, you
can trace *any* event in a real deployment.

### Step 6 — Tear down

```bash
podman-compose down
podman-compose down -v   # also removes named volumes (database, opennms data/config)
```

---

## Part 7 — Reference: events, alarms, and the config that connects them

### What is a UEI?

A **UEI (Universal Event Identifier)** is a unique string name for a type of event — a
URI-shaped string like `uei.opennms.org/nodes/nodeDown`. Every event that enters
OpenNMS carries exactly one UEI.

### Events vs. Alarms

- An **event** is a single, timestamped occurrence. OpenNMS logs every event it
  receives, always.
- An **alarm** is a *deduplicated, stateful* representation of a problem, built from
  events. 500 identical "interface down" events over an hour become **one alarm** whose
  count says "500" — controlled by `alarm-data` configuration.

### `eventconf.xml` and how a UEI becomes configured

`${OPENNMS_HOME}/etc/eventconf.xml`, plus tributary files under `etc/events/`, defines
every known UEI: label, description, severity, log message, and — critically —
`<alarm-data>`. The main file pulls in vendor tributaries in listed order, and events
are matched against the *first* file that defines them. Your own custom (or
SNMP-trap-derived) event definitions must sit above any catch-all files or they will
never be reached.

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
from the trap's OID instead of one you invented — e.g.
`uei.opennms.org/generic/traps/EnterpriseDefault` for an unmapped vendor trap, or a
specific mapped UEI once you've defined one for the Pi's trap OID.

### Decoding `alarm-data`

- **`reduction-key`** — mixes literal text with references to event fields/parameters;
  its purpose is to uniquely identify a problem's *signature* so repeated matching
  events collapse into one alarm instead of creating a new one each time. Convention:
  UEI first, then increasingly specific identifiers, joined with `:`.
- **`alarm-type`**:
  - `1` = a **problem** (something going wrong)
  - `2` = a **resolution/clear** for a matching problem alarm
  - `3` = a notification-only alarm with no associated resolution
- **`clear-key`** — on the "up"/resolved event, must exactly match the `reduction-key`
  of the "down"/problem event it clears. That's the explicit pairing mechanism —
  OpenNMS never guesses which alarm an "up" event resolves.
- **`auto-clean`** — whether the alarm is automatically deleted (not just cleared) after
  a retention window, once resolved.

### Where custom event files go

`${OPENNMS_HOME}/etc/events/custom.events.xml`, registered near the *top* of
`eventconf.xml`:
```xml
<event-file>events/custom.events.xml</event-file>
```
After editing, reload Eventd (Part 5, Step 4) — restarting the container also works but
is heavier-handed than necessary.

### Triggering events: `send-event.pl` vs. the REST API

`send-event.pl` is OpenNMS's built-in Perl utility for scripted event generation, most
often used to reload daemon config without a full restart, and also commonly used to
trigger events from CI scripts or other automation:
```bash
${OPENNMS_HOME}/bin/send-event.pl <uei> [host:port] [options]
```
It normally runs from inside the OpenNMS container. Since the Python container is
separate, the container-friendly equivalent is the REST API — posting an event in XML
to `/rest/events` creates a corresponding event exactly as the raw XML-TCP interface
would, and that endpoint accepts either `application/xml` or `application/json`.

---

## Part 8 — Optional: Podman Pods instead of compose

A **pod** is a Podman-native concept (borrowed from Kubernetes) where multiple
containers share one network namespace — they reach each other over `localhost`, not
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

With a shared network namespace, `py-events` could reach OpenNMS at
`http://localhost:8980/opennms/rest/events` instead of `http://opennms:8980/...`.

Export as Kubernetes YAML:
```bash
podman generate kube opennms-pod > opennms-pod.yaml
```

---

## Part 9 — Troubleshooting

- **OpenNMS container keeps restarting / healthcheck never passes** — check
  `podman-compose logs opennms`; usually the database isn't ready yet. Confirm
  `depends_on: condition: service_healthy` is actually honored — some `podman-compose`
  versions silently downgrade this to "started."
- **`py-events` can't resolve `opennms`** — confirm both are on the same `networks:`
  entry in `podman-compose.yml`.
- **Custom event never appears / alarm never created** — most common mistake: your
  `<event-file>` reference sits *below* a catch-all tributary in `eventconf.xml`;
  matching is top-to-bottom, first match wins.
- **Changes to `eventconf.xml` don't take effect** — you edited the file but didn't
  reload Eventd; re-run the `send-event.pl ... reloadDaemonConfig` step (Part 5, Step
  4).
- **Pi shows as down in OpenNMS but `snmpwalk` from your own machine works fine** —
  check which community string OpenNMS is configured to use for that IP (Part 5, Step
  5); a mismatched community string looks identical to "host down" from OpenNMS's side.
- **Trap never shows in `trapd.log`** — walk Part 6, Step 4's checkpoints in order,
  starting with `tcpdump` on the Pi itself. Most trap issues are network/firewall
  issues before the packet ever arrives at OpenNMS.
- **Rootless Podman and bind-mounted volume permission errors** — rootless containers
  map container UIDs into "subordinate" UID ranges on the host; check `/etc/subuid` and
  `/etc/subgid`, or prefer named volumes (as this stack does) over host bind-mounts.

---

## Part 10 — Security notes

- Change the default `admin/admin` OpenNMS login and default Postgres passwords before
  this touches anything beyond your lab.
- SNMPv2c community strings (like `public` used above) travel in **cleartext** and offer
  no real authentication beyond "knows the string" — fine for an isolated lab VLAN, not
  for anything more exposed. For anything beyond a lab, configure SNMPv3 on the Pi
  (`net-snmp-create-v3-user`) with authentication and privacy, and point OpenNMS's SNMP
  config at the v3 credentials instead.
- Don't expose port `8101` (Karaf SSH) or `5432` (Postgres) beyond your local network —
  bind to `127.0.0.1:8101:8101`, etc., or drop the mapping entirely and reach them only
  from other containers on the private network.
- Never commit real credentials — `.opennms.env`, `.postgres.env`, `py-events/.env`, the
  Pi's community string, or SNMPv3 credentials — to version control. Add them to
  `.gitignore` and commit `.env.example` files instead if you want to share the repo.
- The REST API here uses HTTP Basic Auth over plain HTTP for simplicity — put TLS in
  front of it (reverse proxy, or OpenNMS's own HTTPS connector) for anything beyond
  localhost.

---

## Part 11 — Quick reference

| Task | Docker | Podman |
|---|---|---|
| Run a container | `docker run ...` | `podman run ...` |
| Multi-container stack | `docker compose up -d` | `podman-compose up -d` |
| Build an image | `docker build .` | `podman build .` (or `buildah`) |
| Background service management | `dockerd` (daemon) | none — daemonless |
| Run without root | opt-in, less common | default behavior |
| Group of containers sharing a network namespace | not first-class | **pods** |
| Generate a systemd unit | third-party tooling | `podman generate systemd` |
| Export to Kubernetes YAML | `docker compose convert` (limited) | `podman generate kube` |

## Roadmap & further reading

- Load a real vendor MIB (not just `NET-SNMP-MIB`'s demo trap) for whatever peripheral
  or UPS you have, and define proper `alarm-data` for its trap OIDs.
- Set up **Collectd** performance data collection against the Pi (CPU, memory,
  interface octets via `IF-MIB`) so you have both events *and* time-series graphs.
- Add TLS in front of OpenNMS's `:8980`.
- Add a Grafana dashboard reading OpenNMS's performance data.
- Move the Pi from SNMPv2c to SNMPv3 as a hardening exercise.
- Extend the Python container into a scheduled health-checker (cron / Kubernetes
  CronJob) that emits events automatically on real state changes.

**Reference docs:**
- OpenNMS Horizon documentation — Events & Alarms (`docs.opennms.com`)
- OpenNMS documentation — SNMP, Trapd, and the MIB compiler
- OpenNMS REST API reference (`/rest/events`, `/rest/nodes`, `/rest/alarms`)
- Net-SNMP documentation (`net-snmp.org`) — `snmpd.conf`, `snmpwalk`, `snmptrap`
- Podman documentation — `docs.podman.io`
- `podman-compose` project — GitHub
- PostgreSQL documentation
