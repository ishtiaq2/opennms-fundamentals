# OpenNMS Northbound Gateway - Practice Lab

A hands-on lab for one specific architectural slice of an NMS built on
OpenNMS:

> **The Northbound module focuses entirely on being an API gateway
> (REST/gRPC, rate limiting, request validation).**

This repo builds exactly that, as a small standalone service that sits
in front of OpenNMS - it doesn't collect, poll, or store anything
itself. It authenticates external clients, validates their requests,
enforces rate limits, and forwards clean, validated calls to OpenNMS
over REST and gRPC. All the actual monitoring logic stays where it
already lives: in OpenNMS, and in your custom plugins.

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

## What's included

| Path | What it is |
|---|---|
| `gateway/` | The gateway service itself (FastAPI + grpc, one container, two ports) |
| `mock-backend/` | Optional fake OpenNMS ReST API, for practicing offline |
| `clients/` | Example REST and gRPC clients |
| `podman-compose.yml` | Brings the gateway (and optionally the mock backend) up |
| `GUIDE.md` | Full step-by-step walkthrough, Parts 1-9 |

This is the gateway layer only - it doesn't bundle its own OpenNMS +
PostgreSQL. Point it at your real instance, your Learning Lab repo's
containerized OpenNMS, or the included mock backend. See GUIDE.md Part 4.

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
