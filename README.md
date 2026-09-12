# FreeSWITCH + WebRTC Lab

A self-contained lab: a FreeSWITCH server (built from source, no
SignalWire-hosted auth) handling SIP registration, WebRTC (WSS) calling, and
PSTN routing/bridging against a simulated PSTN peer -- plus a standalone
browser softphone.

- **Design & scope:** [`docs/INTAKE.md`](docs/INTAKE.md)
- **How to run it / make calls:** [`docs/USER_MANUAL.md`](docs/USER_MANUAL.md)
- **Something broken? Start here:** [`docs/DEBUGGING.md`](docs/DEBUGGING.md)

## Quick start

```sh
cp .env.example .env
# edit .env: set EXTERNAL_RTP_IP/EXTERNAL_SIP_IP/TURN_EXTERNAL_IP to your LAN IP

docker compose up -d --build
docker compose ps        # freeswitch + pstn-sim + coturn, all "healthy"

cd webapp && npm install && npm run dev
```

Open `http://localhost:5173`, then see
[`docs/USER_MANUAL.md`](docs/USER_MANUAL.md) for registering extensions and
placing the built-in echo test call.

## Layout

```
freeswitch/       FreeSWITCH image (built from source) + its conf/
pstn-sim/         Same image, different conf/ -- the simulated-PSTN peer
webapp/           Standalone browser softphone (SIP.js + Vite), not in Docker
docker-compose.yml   freeswitch + pstn-sim + coturn
docs/             INTAKE.md, USER_MANUAL.md, DEBUGGING.md
```

## Status

Phase 1 (SIP registration, WebRTC calling, simulated-PSTN bridging) is built
and verified end-to-end. Phase 1.5 (real PSTN trunk, TURN/security hardening)
and Phase 2 (management dashboard) are scoped in `docs/INTAKE.md` but not yet
built.
