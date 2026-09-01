# Northbound Gateway - Step-by-Step Guide

This walks through building and exercising the Northbound module as a
pure API gateway: REST + gRPC in front of OpenNMS, with rate limiting
and request validation as first-class, testable behaviors - not just
a proxy.

**Parts**
1. [What this module is (and isn't)](#part-1---what-this-module-is-and-isnt)
2. [Architecture and request flow](#part-2---architecture-and-request-flow)
3. [Prerequisites and repo layout](#part-3---prerequisites-and-repo-layout)
4. [Choose a backend and bring the gateway up](#part-4---choose-a-backend-and-bring-the-gateway-up)
5. [The REST layer](#part-5---the-rest-layer)
6. [Rate limiting](#part-6---rate-limiting)
7. [The gRPC layer](#part-7---the-grpc-layer)
8. [Auth model and shared validation](#part-8---auth-model-and-shared-validation)
9. [End-to-end checklist and extension ideas](#part-9---end-to-end-checklist-and-extension-ideas)

---

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
