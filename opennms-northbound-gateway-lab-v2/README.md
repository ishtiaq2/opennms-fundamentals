# OpenNMS Northbound - Practice Lab

A hands-on lab covering two different things that both get called
"northbound" in an OpenNMS-based NMS - deliberately, since mixing them
up is a common source of confusion (**GUIDE.md Part 0** covers the
distinction in full):

1. **`gateway/`** - a custom-built REST/gRPC API gateway in front of
   OpenNMS: *pull*. External clients ask; the gateway authenticates,
   rate-limits, validates, and answers.
   > "The Northbound module focuses entirely on being an API gateway
   > (REST/gRPC, rate limiting, request validation)."
2. **`northbounder-lab/`** - OpenNMS's own, built-in **Northbounder**
   framework: *push*. OpenNMS raises an alarm and forwards it,
   unprompted, over SNMP Trap, Syslog, or a scripted webhook, to
   whatever's listening on the other end.

Neither collects, polls, or stores anything itself - all the actual
monitoring logic stays where it already lives: in OpenNMS, and in your
custom plugins.

## Architecture

```
                 ┌─────────────────────────────────────┐
                 │         Northbound Gateway            │
  REST client ──▶│  ┌────────────┐      ┌─────────────┐ │
  (curl,         │  │ FastAPI    │      │ grpc.server  │ │
   Swagger UI) ─▶│  │ :8000      │      │ :50051       │ │◀── gRPC client
                 │  │ REST routes│      │ Servicer     │ │    (Python, grpcurl)
                 │  └─────┬──────┘      └──────┬───────┘ │
                 │        │  auth · rate limit · validate │
                 │        └──────────┬──────────┘         │
                 │            opennms_client.py            │
                 └─────────────────┬─────────────────────┘
                                    │ HTTP Basic (admin:admin)
                                    ▼
                     OpenNMS  (192.168.1.122:8980)
                     /opennms/rest/nodes, /alarms, /events,
                     /opennms/rest/northbound/...  (your plugin)
```

Two protocol adapters (REST, gRPC), one gateway policy underneath:
[`auth.py`](gateway/app/auth.py) (API key), [`rate_limit.py`](gateway/app/rate_limit.py)
(shared token bucket), [`validators.py`](gateway/app/validators.py) (shared business
rules). Neither adapter re-implements any of that - see GUIDE.md Part 8.

`northbounder-lab/` runs the opposite direction - OpenNMS pushes,
these just listen:

```
   OpenNMS (Alarmd)
        │  alarm created
        ├──── Syslog Northbounder ──────▶  syslog-receiver   :5140/udp
        ├──── SNMP Trap Northbounder ───▶  snmptrap-receiver :1162/udp
        └──── BSF Northbounder ─────────▶  webhook-receiver  :9000
              (BeanShell → HTTP POST,       (stands in for ServiceNow/
               see GUIDE.md Part 12)         Jira/a MoM dashboard)
```

Each receiver is a stand-in for whatever real external system your
org would eventually point OpenNMS at - built so you can prove a
northbounder actually fires and see exactly what it sends, without
needing that external system available yet. See GUIDE.md Parts 10-13.

## What's included

| Path | What it is |
|---|---|
| `gateway/` | The gateway service itself (FastAPI + grpc, one container, two ports) |
| `mock-backend/` | Optional fake OpenNMS ReST API, for practicing offline |
| `clients/` | Example REST and gRPC clients for the gateway |
| `podman-compose.yml` | Brings the gateway (and optionally the mock backend) up |
| `northbounder-lab/receivers/` | Syslog, SNMP Trap, and webhook receivers - stand-ins for external systems |
| `northbounder-lab/opennms-northbound-configs/` | Real OpenNMS Northbounder config files, adapted for this lab |
| `northbounder-lab/podman-compose.yml` | Brings the three receivers up |
| `GUIDE.md` | Full step-by-step walkthrough, Parts 0-13 |

Neither half bundles its own OpenNMS + PostgreSQL. Point them at your
real instance, your Learning Lab repo's containerized OpenNMS, or (for
`gateway/` only) the included mock backend. See GUIDE.md Parts 4 and 11.

## Quickstart

```bash
git clone <this-repo>
cd opennms-northbound-gateway-lab

podman network create northbound-lab

cp .env.example .env
# .env defaults to OPENNMS_BASE_URL=http://192.168.1.122:8980 - edit
# if your instance is elsewhere, or switch to the mock backend below.

# Option A: point at a real/already-running OpenNMS
podman-compose up --build

# Option B: no OpenNMS handy? bring up a fake one too
podman-compose --profile mock up --build
```

Then:

```bash
curl -H "X-API-Key: demo-key-123" http://localhost:8000/api/v1/nodes

python3 clients/grpc_client_example.py   # GATEWAY_API_KEY=demo-key-123 by default
```

Full walkthrough, including how rate limiting and validation actually
behave (with real request/response examples): **[GUIDE.md](GUIDE.md)**.

**For `northbounder-lab/`** (separate from the gateway above - see
Part 0 if the relationship isn't clear yet):

```bash
cd northbounder-lab
podman-compose up --build   # webhook :9000, syslog :5140/udp, snmptrap :1162/udp

# then copy opennms-northbound-configs/*.xml into your OpenNMS
# etc-overlay, replace REPLACE_HOST, restart OpenNMS, and trigger
# a real alarm - full walkthrough in GUIDE.md Part 11-12
```

## Relationship to your other OpenNMS repos

- **OpenNMS Learning Lab**: that's where OpenNMS itself runs (the
  `etc-overlay`-configured container, Postgres, the Raspberry Pi SNMP
  target). This repo assumes an OpenNMS is already reachable - either
  that one or your real box - and doesn't duplicate its setup.
- **API Testing & Documentation Toolkit**: that repo's Nginx + Swagger
  UI stack is for *browsing and exercising* OpenNMS's and your
  plugins' ReST APIs directly. This gateway is a runtime component,
  not a docs tool - though nothing stops you pointing that Swagger UI
  at `http://localhost:8000/openapi.json` to browse the gateway's own
  REST surface (FastAPI generates it automatically; see GUIDE.md Part 5).
- Your existing `/opennms/rest/northbound/` plugin: this gateway can
  proxy to it directly (`GET /api/v1/northbound/...`) alongside core
  OpenNMS ReST calls - one external surface, more than one upstream.
- `northbounder-lab/` needs the same reachable OpenNMS as the gateway
  does, but the traffic runs the other way - see the diagram above.
  Its config files are meant to be dropped into your Learning Lab
  repo's `etc-overlay`, not maintained twice.
