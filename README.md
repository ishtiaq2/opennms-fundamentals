# OpenNMS Learning Stack

A hands-on lab for learning **OpenNMS** — network monitoring, SNMP, MIBs/OIDs, and the
event → alarm pipeline — using **Podman**, **PostgreSQL**, a real **Raspberry Pi** as an
SNMP-monitored node, and a small **Python** container that automates custom events over
the REST API.

This is a learning environment, not a production deployment. See
[`docs/STEP-BY-STEP-GUIDE.md`](docs/STEP-BY-STEP-GUIDE.md) for the full walkthrough.

---

## What's in this stack

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

| Component | Role |
|---|---|
| `opennms` | OpenNMS Horizon — monitoring engine, web console, REST API, SNMP trap receiver |
| `database` | PostgreSQL — OpenNMS's persistence layer for nodes, events, alarms |
| `py-events` | Python container that fires custom events at OpenNMS's REST API |
| Raspberry Pi | Real hardware running `net-snmp`, provisioned into OpenNMS as a monitored node |

Two independent paths generate events in this lab, and both are fully traceable:

1. **Real SNMP path** — the Pi sends an SNMP trap → OpenNMS's Trapd receives and
   translates it via loaded MIBs → Eventd matches it against `eventconf.xml`.
2. **Synthetic REST path** — the Python container POSTs an event directly to
   `/rest/events`, simulating an external integration.

Both converge on the same Eventd → `eventconf.xml` → `alarm-data` → alarm pipeline,
which is the core concept this lab is built to teach.

---

## Repository layout

```
.
├── README.md
├── docs/
│   └── STEP-BY-STEP-GUIDE.md      # full walkthrough, start to finish
└── opennms-stack/
    ├── podman-compose.yml
    ├── .opennms.env               # OpenNMS DB connection settings
    ├── .postgres.env              # shared Postgres credentials
    ├── opennms/
    │   └── Dockerfile             # optional customization layer over the official image
    ├── database/
    │   └── Dockerfile             # optional customization layer over the official image
    ├── py-events/
    │   ├── Dockerfile
    │   ├── requirements.txt
    │   ├── send_event.py
    │   └── .env                   # REST endpoint + credentials for the script
    └── etc-overlay/
        └── events/
            └── custom.events.xml  # custom UEI definitions layered into OpenNMS
```

> **Note on the two `Dockerfile`s under `opennms/` and `database/`:** the compose file
> defaults to pulling the official `opennms/horizon` and `postgres` images directly —
> that's the supported, recommended path for both projects. The Dockerfiles are provided
> as an optional customization layer (e.g. baking in `tcpdump`/`iputils-ping` for
> debugging, or pre-loading init SQL) if you want to `build:` instead of `image:`. See
> the step-by-step guide for how to switch.

---

## Prerequisites

- Podman (rootless is fine — nothing here needs `sudo`)
- `podman-compose` (`pip install podman-compose --break-system-packages`)
- A Raspberry Pi (or any Linux box) on the same network, reachable by IP
- Basic comfort with SSH and the command line

## Quickstart

```bash
git clone <your-repo-url>
cd opennms-learning-repo/opennms-stack
podman-compose up -d
podman-compose logs -f opennms   # wait for first-boot schema install to finish
```

Then open `http://localhost:8980/opennms` (login `admin` / `admin`, you'll be prompted
to change it) and follow [`docs/STEP-BY-STEP-GUIDE.md`](docs/STEP-BY-STEP-GUIDE.md) from
Step 4 onward to bring the Raspberry Pi into the picture and fire your first traced
event.

## Learning goals

By the end of the guide you should be able to:

- Explain the difference between a Docker/Podman **image** and a **container**
- Stand up a multi-container stack with `podman-compose`
- Configure and verify an SNMP agent on real hardware
- Explain what an **OID** and a **MIB** are, and how OpenNMS translates one into the
  other
- Provision a device into OpenNMS as a monitored **node**
- Explain the difference between an **event** and an **alarm**, and what
  `reduction-key` / `alarm-type` / `clear-key` do
- Manually trace any event — SNMP trap or REST-submitted — from the wire all the way to
  the alarm on the console, using OpenNMS's own logs and REST API

## Security notes (read before exposing this beyond localhost)

- Default credentials (`admin/admin`, Postgres passwords, SNMP `public` community) are
  lab-only. Change all of them before this touches anything beyond an isolated network.
- SNMPv2c community strings travel in cleartext. Prefer SNMPv3 (auth + privacy) for
  anything beyond a lab VLAN.
- Don't publish port `8101` (Karaf SSH) or `5432` (Postgres) beyond your local network.

Full details in the step-by-step guide's Security section.

## License

Add your license of choice here (e.g. MIT) before publishing.
