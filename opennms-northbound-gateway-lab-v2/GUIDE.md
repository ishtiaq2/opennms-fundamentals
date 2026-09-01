# Northbound Gateway - Step-by-Step Guide

This walks through building and exercising the Northbound module as a
pure API gateway: REST + gRPC in front of OpenNMS, with rate limiting
and request validation as first-class, testable behaviors - not just
a proxy.

**Parts**
0. [Northbound vs. Southbound - and the two different "Northbound"s in this repo](#part-0---northbound-vs-southbound---and-the-two-different-northbounds-in-this-repo)
1. [What this module is (and isn't)](#part-1---what-this-module-is-and-isnt)
2. [Architecture and request flow](#part-2---architecture-and-request-flow)
3. [Prerequisites and repo layout](#part-3---prerequisites-and-repo-layout)
4. [Choose a backend and bring the gateway up](#part-4---choose-a-backend-and-bring-the-gateway-up)
5. [The REST layer](#part-5---the-rest-layer)
6. [Rate limiting](#part-6---rate-limiting)
7. [The gRPC layer](#part-7---the-grpc-layer)
8. [Auth model and shared validation](#part-8---auth-model-and-shared-validation)
9. [End-to-end checklist and extension ideas](#part-9---end-to-end-checklist-and-extension-ideas)
10. [OpenNMS's native Northbounder framework](#part-10---opennmss-native-northbounder-framework)
11. [Practice: Syslog and SNMP Trap Northbounders](#part-11---practice-syslog-and-snmp-trap-northbounders)
12. [Practice: forwarding to a webhook (BSF Northbounder)](#part-12---practice-forwarding-to-a-webhook-bsf-northbounder)
13. [Why alarms can be "built to forward" and still forward nowhere](#part-13---why-alarms-can-be-built-to-forward-and-still-forward-nowhere)

Parts 1-9 build a **custom** REST/gRPC gateway (a *pull* API - clients
ask, the gateway answers). Parts 10-13 are about OpenNMS's own,
built-in Northbounder framework (a *push* mechanism - OpenNMS decides
something's wrong and forwards it, unprompted). Part 0 explains why
both are legitimately called "northbound" and how they differ - read
that first if you're new to either term.

---

## Part 0 - Northbound vs. Southbound - and the two different "Northbound"s in this repo

Picture network architecture as a vertical stack:

```
   Business apps / MoM     ServiceNow, Jira, a company-wide dashboard,
   ("upward")              Splunk, Grafana, Kafka consumers...
        ▲
        │  NORTHBOUND - the NMS exports/forwards data upward
        │
   ┌─────────────┐
   │   OpenNMS    │
   └─────────────┘
        │
        │  SOUTHBOUND - the NMS talks down to what it manages
        ▼
   Physical hardware       switches, routers, your Raspberry Pi
   ("downward")            (SNMP, NetFlow, SSH, ICMP...)
```

- **Southbound** is how OpenNMS talks *down* to devices: polling for
  status and metrics, receiving raw traps. You've already built this -
  it's exactly what your Learning Lab repo's SNMP-monitored Raspberry
  Pi is. Nothing new to build here; it's mentioned so the full picture
  is in one place.
- **Northbound** is how OpenNMS talks *up* to whatever sits above it.
  Critically, "northbound" describes a *direction data flows*, not one
  specific technology - forwarding a critical alarm to a
  Manager-of-Managers dashboard, auto-filing a ticket in ServiceNow,
  and publishing metrics to a Kafka bus are all "northbound," even
  though they share almost no implementation in common.

**That last point is exactly why this repo has two things both
legitimately called "northbound," and they work in opposite ways:**

| | Parts 1-9: the custom Gateway (`gateway/`) | Parts 10-13: OpenNMS's native Northbounder (`northbounder-lab/`) |
|---|---|---|
| Direction | External client calls **in** | OpenNMS pushes **out**, unprompted |
| Trigger | A REST/gRPC request arrives | Alarmd decides an alarm qualifies |
| Model | Pull - client asks a question | Push - OpenNMS makes an announcement |
| Built by | Us, from scratch, in Python | OpenNMS core, we just configure it |
| Protocols | REST, gRPC (our choice) | SNMP Trap, Syslog, JMS, AMQP, scripted (OpenNMS's choice) |
| Answers | "What's node 12's status right now?" | "Node 12 just went down - here, MoM/ticketing system." |

Both are real, both are common in production NMS deployments, and
neither is "the" northbound interface - they're two different
northbound *mechanisms* an NMS can offer at the same time, and OpenNMS
itself ships with support for both patterns (a queryable ReST API, and
the Northbounder alarm-forwarding framework you'll build against
starting in Part 10). If someone says "our NMS doesn't send alarms
northbound," they're almost always talking about the Part 10-13 kind -
alarms not reaching an external system automatically - not about
whether a REST API to query data exists. That distinction is the
difference between "we built the capability to forward" and "someone
downstream is actually listening" - which Part 13 comes back to.

## Part 1 - What this module is (and isn't)

In NMS architectures, "northbound" describes the direction a system
exposes itself *upward*, to other management systems, dashboards, or
operators - as opposed to "southbound," which is how it talks *down*
to the devices it manages (SNMP polling your Raspberry Pi, for
example). A Northbound module's job is to be the front door: it's the
only part of the system external callers ever touch directly.

That gives it a specific, narrow job description:

- **REST/gRPC** - expose the system's data over two protocols, not one.
- **Rate limiting** - protect the backend from being hammered, by
  whoever's calling and however they're calling it.
- **Request validation** - reject malformed or out-of-range requests
  *before* they reach OpenNMS, with a clear reason why.

Notice what's **not** in that list: no collection, no persistence, no
alarm logic, no event processing. This module doesn't know how SNMP
works and doesn't care. It's a gatekeeper, not a worker. Every
request it lets through gets forwarded to OpenNMS (or your custom
plugin) essentially unchanged; every request it rejects never gets
that far.

This lab builds that gatekeeper as its own standalone service
(`gateway/`) rather than folding gateway logic into the OSGi/JAX-RS
plugin from your other repos. That split is deliberate and mirrors
how real NMS platforms are usually built: the plugin (or OpenNMS
itself) is the system of record; the gateway is a separate process
whose only job is guarding access to it. It's also just easier to
build and test - no Karaf shell, no bundle lifecycle, and much faster
iteration.

**What this lab intentionally leaves out**, so the scope stays honest:
production concerns like TLS/mTLS, a real identity provider instead
of static API keys, and a distributed rate-limit store. Those are
flagged as extension exercises in Part 9, not built here - adding them
now would bury the three things this module is actually about under a
pile of unrelated infrastructure.

## Part 2 - Architecture and request flow

```
  REST client                                      gRPC client
  (curl, Swagger UI)                                (Python, grpcurl)
        │                                                  │
        │ GET /api/v1/alarms?severity=CRITICAL             │ ListAlarms(severity="CRITICAL")
        │ X-API-Key: demo-key-123                          │ metadata: x-api-key=demo-key-123
        ▼                                                  ▼
  ┌──────────────────┐                            ┌──────────────────┐
  │ FastAPI  :8000    │                            │ grpc.server :50051│
  │ rate_limit_       │                            │ RateLimitInterceptor│
  │ middleware        │                            │ ApiKeyInterceptor  │
  │ require_api_key   │                            │                    │
  │ routes.py         │                            │ servicer.py        │
  └─────────┬─────────┘                            └─────────┬──────────┘
            │              validators.py (shared)             │
            │◀───────────────────────────────────────────────▶│
            │                                                  │
            └───────────────────┬──────────────────────────────┘
                                 ▼
                        opennms_client.py
                     (HTTP Basic: admin:admin)
                                 ▼
                    OpenNMS  /opennms/rest/...
```

One request, either protocol, follows the same four steps:

1. **Authenticate** - is there a valid `X-API-Key` (REST header) or
   `x-api-key` (gRPC metadata)? If not: `401` / `UNAUTHENTICATED`.
2. **Rate limit** - has this API key used up its token bucket? If so:
   `429` / `RESOURCE_EXHAUSTED`, with a retry-after estimate.
3. **Validate** - are the parameters sane (positive node ID, a real
   severity, a limit within bounds)? If not: `422` / `INVALID_ARGUMENT`.
4. **Forward** - call OpenNMS via `opennms_client.py`, using a
   *different* credential (HTTP Basic, `admin:admin`) than the one the
   external client presented. The gateway translates between two
   trust zones; it doesn't just pass a header through.

## Part 3 - Prerequisites and repo layout

You'll need:
- Podman + `podman-compose`
- Python 3.11+ (only for running the example clients locally, or
  regenerating gRPC stubs - the gateway itself only needs Python
  inside its container)
- An OpenNMS instance reachable from wherever the gateway runs - your
  real one at `192.168.1.122:8980`, the containerized one from your
  Learning Lab repo, or this repo's mock backend (Part 4 covers all
  three)

```
opennms-northbound-gateway-lab/
├── README.md
├── GUIDE.md
├── podman-compose.yml
├── .env.example
├── gateway/
│   ├── Dockerfile
│   ├── requirements.txt
│   └── app/
│       ├── main.py            # FastAPI app, rate-limit middleware, starts gRPC too
│       ├── config.py          # all settings, env-driven
│       ├── auth.py            # REST API-key check
│       ├── rate_limit.py      # shared TokenBucketLimiter
│       ├── validators.py      # shared business-rule validation
│       ├── opennms_client.py  # the only module that knows OpenNMS's URLs/shapes
│       ├── routes.py          # REST endpoints
│       ├── schemas.py         # Pydantic response models
│       └── grpc_app/
│           ├── northbound.proto
│           ├── generate.sh        # regenerate stubs (documents a real gotcha - see Part 7)
│           ├── northbound_pb2.py, northbound_pb2_grpc.py   # generated, committed
│           ├── interceptors.py    # gRPC auth + rate-limit interceptors
│           ├── servicer.py        # gRPC method implementations
│           └── server.py          # grpc.server bootstrap
├── mock-backend/               # optional fake OpenNMS for offline practice
│   ├── Dockerfile
│   └── app.py
└── clients/
    ├── rest_client_example.py
    └── grpc_client_example.py
```

## Part 4 - Choose a backend and bring the gateway up

The gateway needs *something* speaking OpenNMS's ReST API on the other
end. Pick one path.

### 4a. Your real OpenNMS instance (recommended if it's reachable)

This is the default. `.env.example` already points at it:

```bash
cp .env.example .env
# OPENNMS_BASE_URL=http://192.168.1.122:8980 - edit if yours differs
```

### 4b. No OpenNMS handy? Use the included mock backend

`mock-backend/app.py` is a small FastAPI app that returns realistic
shapes for `/opennms/rest/info`, `/nodes`, `/alarms`, `/events`, and
your custom `/northbound/...` plugin path - three fake nodes, three
fake alarms, two fake events. It's not a substitute for the real
thing, but it's enough to practice REST/gRPC, rate limiting, and
validation without your lab network in the loop:

```bash
podman network create northbound-lab   # one-time
podman-compose --profile mock up --build
```

and in `.env`, set:

```
OPENNMS_BASE_URL=http://mock-backend:8980
```

(Running it outside a container, e.g. for quick local testing:
`uvicorn app:app --app-dir mock-backend --port 8980`.)

### 4c. The containerized OpenNMS from your Learning Lab repo

If that stack's `opennms` container is on a podman network the
gateway can also join, point `OPENNMS_BASE_URL` at it by service name
(`http://opennms:8980`) and make sure both compose projects share a
network - the simplest way is adding `networks: northbound-lab:
external: true` to that repo's compose file too, the same way this
repo's does.

### Bring the gateway up

```bash
podman network create northbound-lab   # skip if you already did this in 4b
cp .env.example .env                   # if you haven't already
podman-compose up --build
```

Check both ports came up:

```bash
curl http://localhost:8000/health
# {"status":"ok","backend":"http://192.168.1.122:8980"}
```

If `status` comes back `"unreachable"`, the gateway container itself
is fine - it just can't reach `OPENNMS_BASE_URL`. Double check the URL
in `.env` and that it's reachable from *inside* the container's
network, not just from your host.

## Part 5 - The REST layer

Routes live in [`gateway/app/routes.py`](gateway/app/routes.py). Every
route except `/health` requires `X-API-Key` (checked by
[`auth.py`](gateway/app/auth.py)'s `require_api_key` dependency) and
validates its inputs with [`validators.py`](gateway/app/validators.py)
before calling OpenNMS.

```bash
# no key -> 401
curl -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/v1/nodes
# 401

# with key -> works
curl -H "X-API-Key: demo-key-123" "http://localhost:8000/api/v1/nodes?limit=2"
```

**Two layers of validation, on purpose.** FastAPI/Pydantic handles
*type* validation for free, straight from the function signature
(`limit: int = 20` in `routes.py`):

```bash
curl -H "X-API-Key: demo-key-123" "http://localhost:8000/api/v1/nodes?limit=abc"
```
```json
{"detail":[{"type":"int_parsing","loc":["query","limit"],
  "msg":"Input should be a valid integer, unable to parse string as an integer",
  "input":"abc"}]}
```

`validators.py` handles *business-rule* validation on top of that -
things no type system knows about, like "limit shouldn't exceed 200"
or "severity has to be one of these seven values":

```bash
curl -H "X-API-Key: demo-key-123" "http://localhost:8000/api/v1/alarms?limit=9999"
```
```json
{"detail":"limit must be between 1 and 200, got 9999"}
```
```bash
curl -H "X-API-Key: demo-key-123" "http://localhost:8000/api/v1/alarms?severity=NOT_REAL"
```
```json
{"detail":"severity must be one of ['CLEARED', 'CRITICAL', 'INDETERMINATE', 'MAJOR', 'MINOR', 'NORMAL', 'WARNING'], got 'NOT_REAL'"}
```

Both come back as `422`, but for different reasons - and that
distinction (framework-level type checking vs. your own domain rules)
is exactly the kind of thing "request validation" means for a gateway,
as opposed to just "does this JSON parse."

**One gateway, more than one upstream surface.** `GET
/api/v1/northbound/{subpath}` proxies straight through to your
existing custom plugin at `/opennms/rest/northbound/...`, alongside
core OpenNMS ReST calls - the gateway doesn't care that they're
different backends under the hood; external clients see one
consistent API.

**Auto-generated docs.** FastAPI builds an OpenAPI spec and a Swagger
UI for the gateway itself, no annotations needed:
`http://localhost:8000/docs`. Worth noting since it's a live
comparison to your other repo's approach: FastAPI currently emits
**OpenAPI 3.1.0** here (check `http://localhost:8000/openapi.json`),
not the 3.0.1 your `io.swagger.core.v3`-annotated Java plugin
produces. If you want to feed this into that repo's Swagger UI
toolkit and hit rendering issues over the version gap, you can pin it
with `app.openapi_version = "3.0.2"` in `main.py` - flagged here
rather than done, since it's a one-line change only worth making if
you actually need it.

## Part 6 - Rate limiting

[`rate_limit.py`](gateway/app/rate_limit.py)'s `TokenBucketLimiter` is
a small, dependency-free token bucket: each API key gets a bucket that
holds `RATE_LIMIT_REQUESTS` tokens (default 20) and refills at
`RATE_LIMIT_REQUESTS / RATE_LIMIT_WINDOW_SECONDS` tokens/second. Every
request consumes one token; an empty bucket means `429` with a
computed `Retry-After`.

Token bucket rather than a fixed window deliberately: it tolerates
short bursts (a client that's been quiet can spend its saved-up
tokens quickly) while still capping the *average* rate, and it doesn't
have the "everyone retries at the exact same instant the window
rolls over" problem a fixed window has.

Try it with a deliberately tight limit:

```bash
# .env: RATE_LIMIT_REQUESTS=3, RATE_LIMIT_WINDOW_SECONDS=10
for i in $(seq 1 6); do
  curl -s -o /dev/null -H "X-API-Key: demo-key-123" \
    -w "req $i -> %{http_code}\n" http://localhost:8000/api/v1/nodes
done
```
```
req 1 -> 200
req 2 -> 200
req 3 -> 200
req 4 -> 429
req 5 -> 429
req 6 -> 429
```

The response also carries `Retry-After` (seconds, as a float):

```bash
curl -sI -H "X-API-Key: demo-key-123" http://localhost:8000/api/v1/nodes | grep -i retry-after
```

**This is enforced identically on the gRPC side** -
[`interceptors.py`](gateway/app/grpc_app/interceptors.py)'s
`RateLimitInterceptor` uses the exact same `TokenBucketLimiter` class,
keyed by the same `x-api-key` metadata value, and aborts with
`RESOURCE_EXHAUSTED` instead of returning `429`. One caveat worth
being upfront about: `main.py` and `grpc_app/server.py` each construct
their *own instance* of the limiter, so a client currently gets a
separate budget on REST vs. gRPC, not one shared budget across both.
Unifying them into a single shared instance is a one-line change
(pass the same object into both) - left as-is here so each protocol's
rate-limiting code is independently readable; see Part 9.

The limiter is in-memory and per-process, which is the right
trade-off for one gateway container. Run more than one replica and
each enforces its own limit independently - see Part 9 for the
Redis-backed alternative.

## Part 7 - The gRPC layer

[`northbound.proto`](gateway/app/grpc_app/northbound.proto) defines
five RPCs mirroring the REST surface, plus one REST can't easily do:
`StreamEvents`, a server-streaming call that polls OpenNMS and pushes
new events to the client as they appear - a real, working example of
something gRPC is better suited to than plain REST polling.

**A gotcha worth knowing before you touch the `.proto` file.**
`protoc`'s Python plugin generates `northbound_pb2_grpc.py` with a
flat `import northbound_pb2 as northbound__pb2` line - correct for a
standalone script, but broken once these files live inside a package
(`app.grpc_app`), because Python can't find a top-level
`northbound_pb2` module from in there. [`generate.sh`](gateway/app/grpc_app/generate.sh)
regenerates the stubs *and* patches that line to a relative import
(`from . import northbound_pb2 ...`) with `sed`, so it works
consistently as part of the package. If you edit the `.proto`, always
regenerate via that script rather than calling `protoc` directly, or
you'll hit `ImportError: attempted relative import with no known
parent package` the moment anything imports the gRPC module:

```bash
./gateway/app/grpc_app/generate.sh
```

That same patch is *why* [`clients/grpc_client_example.py`](clients/grpc_client_example.py)
imports the stubs via `from app.grpc_app import northbound_pb2,
northbound_pb2_grpc` (adding `gateway/` to `sys.path` first) rather
than importing them as flat top-level modules - it has to go through
the package the same way the server does, or the relative import
inside `northbound_pb2_grpc.py` has nothing to resolve against.

**Trying it:**

```bash
GATEWAY_API_KEY=demo-key-123 python3 clients/grpc_client_example.py
```
```
== HealthCheck ==
status: "ok"
backend: "http://192.168.1.122:8980"

== ListNodes (limit=5) ==
nodes {
  node_id: 1
  label: "core-switch-01"
  sys_object_id: ".1.3.6.1.4.1.9.1.1208"
  provisioned: true
}
...
total: 3
```

Wrong or missing key:
```python
# metadata=[("x-api-key", "wrong-key")]
# -> grpc.RpcError: UNAUTHENTICATED - Missing or invalid x-api-key metadata
```

**Interceptors and streaming don't mix simply - here's the fix.** A
gRPC interceptor that wants to *reject* a call has to hand back a
handler shaped like the original one, or the server breaks: a unary
RPC needs a `unary_unary` handler, but `StreamEvents` needs a
`unary_stream` one. [`interceptors.py`](gateway/app/grpc_app/interceptors.py)
handles this by calling `continuation()` first to get the real
handler, checking `handler.response_streaming`, and only then
building a matching abort handler if the call should be blocked. This
was tested directly against `StreamEvents` (both with a bad key and
under rate-limiting) to confirm it aborts cleanly instead of hanging
or crashing the server - worth knowing if you add more streaming RPCs
later, since it's an easy thing to get subtly wrong.

`StreamEvents` itself is capped at 20 polls in `servicer.py` so a demo
run doesn't stream forever if you forget to disconnect - remove that
cap for a "real" long-lived stream.

## Part 8 - Auth model and shared validation

Two different credentials are in play, deliberately:

- **`X-API-Key` / `x-api-key`** - what *external clients* present to
  the gateway. Checked against `GATEWAY_API_KEYS` in `.env`, by
  [`auth.py`](gateway/app/auth.py) on the REST side and
  [`interceptors.py`](gateway/app/grpc_app/interceptors.py) on the
  gRPC side.
- **HTTP Basic (`admin:admin`)** - what the *gateway* presents to
  *OpenNMS*, in [`opennms_client.py`](gateway/app/opennms_client.py).
  External clients never see or hold this.

That split is a real API-gateway responsibility, not an incidental
detail: the gateway is a trust boundary. Clients authenticate to it
under one scheme; it authenticates onward under another, using a
service account it controls. Swapping `GATEWAY_API_KEYS` for
per-client JWTs later wouldn't need OpenNMS's credentials to change at
all, and vice versa.

The API-key *check itself* is necessarily written twice - once as a
FastAPI dependency, once as a gRPC interceptor - because REST headers
and gRPC metadata are plumbed through their frameworks differently.
Both read from the same `settings.api_keys`, so there's one source of
truth even though there are two integration points.

`validators.py`, on the other hand, **is** literally shared code, not
just shared policy - `routes.py` and `servicer.py` both import and
call the exact same `validate_node_id` / `validate_severity` /
`validate_limit` functions. A REST client and a gRPC client sending
the same bad `severity` get the same rejection message, because it's
the same function raising it.

## Part 9 - End-to-end checklist and extension ideas

Quick verification, both protocols, all three gateway behaviors:

```bash
curl http://localhost:8000/health
curl -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/v1/nodes            # 401
curl -H "X-API-Key: demo-key-123" http://localhost:8000/api/v1/nodes                # 200
curl -H "X-API-Key: demo-key-123" "http://localhost:8000/api/v1/nodes/-1"            # 422
python3 clients/grpc_client_example.py                                               # gRPC happy path
python3 clients/rest_client_example.py                                               # REST happy path + rate-limit demo
```

**Extension ideas**, roughly in order of how much they'd teach you
about production API gateways specifically:

1. **Unify the two rate limiters.** Pass one `TokenBucketLimiter`
   instance into both `main.py` and `grpc_app/server.py` so a client's
   REST and gRPC calls draw from one shared budget (Part 6).
2. **Redis-backed limiter.** Swap `TokenBucketLimiter`'s in-memory
   `dict` for Redis `INCR`+`TTL` (or a Lua token-bucket script) so the
   limit holds even if you scale the gateway to multiple replicas.
3. **JWT auth instead of static keys.** Replace the `GATEWAY_API_KEYS`
   check with signed JWTs carrying per-client scopes - lets you do
   per-client rate limits and per-endpoint authorization, not just
   "in the list or not."
4. **Full REST/gRPC parity.** Right now a few things (like the
   northbound-plugin passthrough) are REST-only; add the equivalent
   gRPC RPCs.
5. **Resilience.** Add a timeout+retry (or a small circuit breaker)
   around `opennms_client.py` calls, so a slow/down OpenNMS degrades
   the gateway gracefully instead of piling up hung requests.
6. **TLS.** `add_insecure_port` → `add_secure_port` for gRPC, and put
   the REST side behind TLS termination (Nginx from your API Testing
   Toolkit repo would do that job well).

---

## Part 10 - OpenNMS's native Northbounder framework

Everything from here on is a different thing wearing the same name -
see Part 0 if you jumped straight here. This is about `northbounder-lab/`:
OpenNMS's own, built-in mechanism for pushing alarms to external
systems the moment they're created, not the custom gateway from Parts 1-9.

When OpenNMS raises an alarm, `Alarmd` hands it to every enabled
**Northbounder**. Each one decides independently whether it applies
(via a filter rule) and, if so, forwards the alarm in its own format
to its own destination. Confirmed directly from the OpenNMS source
tree (not just docs, which lag releases) - `opennms-base-assembly/src/main/filtered/etc/`
ships default, disabled-by-default config for:

| Northbounder | Config file | Sends to |
|---|---|---|
| Syslog | `syslog-northbounder-configuration.xml` | A syslog server, over UDP/TCP |
| SNMP Trap | `snmptrap-northbounder-configuration.xml` | An SNMP trap receiver (a MoM, typically) |
| Email | `email-northbounder-configuration.xml` | SMTP |
| JMS | `jms-northbounder-configuration.xml` | A JMS broker |
| BSF (scripted) | `bsf-northbounder-configuration.xml` | Anywhere a BeanShell/Groovy/JS script can reach |
| Drools (rules) | `drools-northbounder-configuration.xml` | Anywhere a Drools rule's action can reach |

There's also an AMQP alarm northbounder (a separate Camel/OSGi
feature, configured via Karaf shell rather than an `etc/` file) and a
newer Kafka producer feature (`org.opennms.features.kafka.producer`)
that publishes alarms/events/nodes to Kafka topics - the modern,
message-bus-first answer to "get OpenNMS data into other systems,"
and worth knowing about even though this lab doesn't stand up a
Kafka broker to exercise it.

**An honest gap, rather than a guess:** OpenNMS's own javadocs
confirm an `HttpNorthbounder` Java class exists (it's listed as a
`Northbounder` implementation going back to at least version 17), but
unlike every northbounder in the table above, there's no shipped
`etc/*-northbounder-configuration.xml` for it in the current OpenNMS
source tree. That could mean it's older/less commonly deployed, wired
up differently (e.g. only via the OSGi/Karaf side rather than a
filtered `etc/` template), or version/edition-dependent. Rather than
publish a plausible-looking XML schema I couldn't verify against real
source, Part 12 gets you the same outcome - alarms forwarded to a REST
endpoint - through the BSF Northbounder instead, which *is* shipped
and documented. If your OpenNMS version turns out to have a working
HTTP Northbounder, swap it in; the receiver in this lab doesn't care
which one calls it.

All of these share the same lifecycle: edit the config, flip
`<enabled>` to `true`, get OpenNMS to pick up the change (restart, or
`reloadDaemonConfig` for the affected daemon), and watch `opennms.log`
if nothing arrives.

## Part 11 - Practice: Syslog and SNMP Trap Northbounders

Bring the receivers up:

```bash
cd northbounder-lab
podman network create northbound-lab   # skip if it already exists
podman-compose up --build
```

That starts `syslog-receiver` (UDP :5140), `snmptrap-receiver` (UDP
:1162), and `webhook-receiver` (:9000, used in Part 12).

**Wire up the config.** Copy
[`opennms-northbound-configs/syslog-northbounder-configuration.xml`](northbounder-lab/opennms-northbound-configs/syslog-northbounder-configuration.xml)
and
[`snmptrap-northbounder-configuration.xml`](northbounder-lab/opennms-northbound-configs/snmptrap-northbounder-configuration.xml)
into your OpenNMS instance's `etc-overlay` (from your Learning Lab
repo), replacing `REPLACE_HOST` in each with:
- `syslog-receiver` / `snmptrap-receiver` - if OpenNMS is a container
  on the same `northbound-lab` podman network as these receivers
- your real LAN IP - if OpenNMS is elsewhere (e.g. your
  `192.168.1.122` box) and only these receivers' published host ports
  are reachable from it

For the SNMP Trap Northbounder specifically, also check
`etc/snmp-config.xml` has an entry (or relies on the top-level
default) for that same host with `version` `v2c` - the northbounder
looks up community/security settings there, not in its own config
file. If traps never arrive, this is the first thing to check.

Restart OpenNMS (or reload the affected daemon) after copying the
files in.

**Trigger a real alarm** the same way you already do in your Learning
Lab repo - `send-event.pl`, or actually taking the Raspberry Pi
offline for a moment so a real `nodeDown` fires. Then watch the
receiver logs:

```bash
podman-compose logs -f syslog-receiver snmptrap-receiver
```

You should see something like this (captured from this lab's own test
run, sending a stand-in alarm by hand with `snmptrap`/a raw syslog
packet rather than a live OpenNMS instance - the shape is what
matters):

```
# syslog-receiver
RECEIVER: from ('172.19.0.4', 46522) [local0.info] host=opennms-server:
    ALARM ID:7 NODE:raspberrypi-lab SEV:CRITICAL; down

# snmptrap-receiver
INFO: from ('172.19.0.4', 38434): SNMP v2c trap from community='public',
    snmpTrapOID=1.3.6.1.4.1.99999.3
INFO:     1.3.6.1.4.1.99999.3.1 (OctetString) = '7'
INFO:     1.3.6.1.4.1.99999.3.2 (OctetString) = 'raspberrypi-lab'
INFO:     1.3.6.1.4.1.99999.3.3 (OctetString) = 'CRITICAL'
INFO:     1.3.6.1.4.1.99999.3.4 (OctetString) = 'down'
```

`snmptrap-receiver`'s decoder
([`decoder.py`](northbounder-lab/receivers/snmptrap-receiver/decoder.py))
is a from-scratch BER parser, not a wrapper around a library - it was
written and verified against real packets from net-snmp's own
`snmptrap` command (both v1 and v2c) specifically so this lab doesn't
depend on guessing at wire format. Worth a read if you want to see
what's actually inside an SNMP trap once you strip away the tooling.

## Part 12 - Practice: forwarding to a webhook (BSF Northbounder)

Same pattern, different config. Copy
[`opennms-northbound-configs/bsf-northbounder-configuration.xml`](northbounder-lab/opennms-northbound-configs/bsf-northbounder-configuration.xml)
into your `etc-overlay`, replacing `REPLACE_HOST` the same way as
Part 11 (target: `webhook-receiver:9000` or your LAN IP `:9000`).

This file's `<onAlarm>` block is a BeanShell script - real Java-ish
code, not a template language - that builds a small JSON body from the
alarm's fields (`id`, `uei`, `nodeLabel`, `severity`, `logMsg` - the
same `NorthboundAlarm` fields the SNMP Trap Northbounder's SPEL rules
use) and POSTs it with `java.net.HttpURLConnection`. It's the least
battle-tested of the three northbounders here, precisely because it's
running arbitrary code rather than OpenNMS's own well-exercised
Syslog/SNMP Trap paths - if it doesn't fire, check `opennms.log` /
Karaf's log for BSF/BeanShell errors first.

Trigger an alarm the same way as Part 11, then check either the logs
or the receiver's own inspection endpoint:

```bash
curl http://localhost:9000/received
```

```json
{"count": 1, "alarms": [{"received_at": "2026-...", "body":
  {"alarmId": 7, "uei": "uei.opennms.org/nodes/nodeDown",
   "nodeLabel": "raspberrypi-lab", "severity": "CRITICAL", "logMsg": "down"}}]}
```

(That example response is real output from posting a stand-in alarm
straight to `webhook-receiver` during testing - `POST
/opennms/alarm` and `GET /received` were both exercised directly to
confirm the receiver's behavior before wiring the BeanShell side in.)

## Part 13 - Why alarms can be "built to forward" and still forward nowhere

Worth spelling out, since it's a common source of confusion (and often
the exact complaint that starts this conversation at work): a
Northbounder being *built* and a Northbounder being *effective* are
two different milestones, with a real gap between them.

Enabling `snmptrap-northbounder-configuration.xml` only means OpenNMS
will *send* traps to whatever `<ip-address>` is configured. Nothing
about that guarantees anything is listening there, parsing what
arrives, or acting on it. Both ends have to be true at once:
- **Sending side** (your job, Parts 10-12): the northbounder is
  enabled, correctly configured, and actually firing - visible in
  `opennms.log` or by watching the wire.
- **Receiving side** (someone else's job, unless you're testing with
  this lab's stand-ins): a listener is actually running, actually
  configured to accept from your host/community/format, and something
  downstream actually consumes what it receives rather than the
  packets just accumulating in a log no one reads.

An org building the sending side and calling it done - while the
receiving side was never confirmed to be listening - is exactly how
you end up with "we forward alarms northbound" and "we don't receive
any alarms" both being true statements at the same time, from two
different teams, about the same integration. The three receivers in
`northbounder-lab/` exist so you can be the second team too, at least
long enough to prove the pipe works end to end before anyone else's
listener enters the picture.
