# User Manual: FreeSWITCH + WebRTC Lab

Companion to [`INTAKE.md`](INTAKE.md) (design/scope) and [`DEBUGGING.md`](DEBUGGING.md)
(troubleshooting). This is Phase 1 as scoped in the intake doc: SIP
registration, WebRTC calling, and a simulated-PSTN bridge -- all built from
source, no SignalWire-hosted auth of any kind.

## 1. What's running

| Service | What it is | Exposed to host |
|---|---|---|
| `freeswitch` | The FreeSWITCH server: SIP registration, media, dialplan, the PSTN gateway | 5060 (SIP), 7443 (WSS), 16384-16584 (RTP) |
| `pstn-sim` | A second FreeSWITCH instance standing in for a real PSTN carrier | nothing (internal network only) |
| `coturn` | STUN/TURN for WebRTC NAT traversal | 3478, 5349, 49152-49352 |
| `webapp` | Browser softphone (SIP.js) | not containerized -- run with `npm` |

## 2. Prerequisites

- Docker Desktop (with Compose v2)
- Node.js 18+ (for the webapp)
- A Mac/Linux host with a real LAN IP if you want to test from a phone/other
  device on your network (localhost-only testing works with no extra setup)

## 3. First-time setup

```sh
cp .env.example .env
```

Edit `.env`:

- **`EXTERNAL_RTP_IP` / `EXTERNAL_SIP_IP` / `TURN_EXTERNAL_IP`**: set all
  three to your machine's LAN IP (`ipconfig getifaddr en0` on macOS). Leaving
  these as `127.0.0.1` only works if the browser and FreeSWITCH are on the
  exact same machine talking over `localhost` -- see
  [`DEBUGGING.md`](DEBUGGING.md#no-audio-call-connects-but-no-audio) before
  assuming it "should just work."
- **`EXT_1000_PASSWORD`** through **`EXT_1003_PASSWORD`**: change from the
  placeholder defaults, especially before this is reachable from anywhere but
  your own machine.
- Everything else can stay as-is for local dev.

## 4. Start the stack

```sh
docker compose up -d --build
docker compose ps        # all three should show "healthy" within ~30s
```

Start the webapp separately (it is intentionally not a Docker service, see
[`INTAKE.md`](INTAKE.md) §2):

```sh
cd webapp
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL.

## 5. The extension/numbering plan

| Range | Purpose |
|---|---|
| `1000`-`1003` | Internal WebRTC/SIP extensions (register from the webapp or a real SIP client) |
| `2000`-`2099` | Simulated-PSTN side, reached through the `pstn_sim` gateway. `2000` specifically: auto-answers and **echoes your own audio back** if nothing is registered there -- this is the built-in round-trip test |

## 6. Making calls

**First**, open `https://localhost:7443` in your browser once and click
through the self-signed certificate warning -- this is a one-time step per
browser profile (see [`DEBUGGING.md`](DEBUGGING.md#browser-wont-connect-over-wss)).

**Browser-to-browser:** open the webapp in two tabs (or two browsers),
register one as `1000` and the other as `1001` (with their respective
passwords from `.env`), then dial `1001` from the first tab.

**Browser-to-simulated-PSTN (echo test):** register as `1000`, dial `2000`.
You should hear your own voice echoed back after a short delay -- this proves
the full path: browser → FreeSWITCH → the `pstn_sim` gateway → pstn-sim →
back.

**Verifying without a browser** (useful for CI/headless checks): from inside
the `freeswitch` container,

```sh
docker exec fswebrtclab-freeswitch fs_cli -x "originate sofia/gateway/pstn_sim/2000 &park"
docker exec fswebrtclab-freeswitch fs_cli -x "show channels"   # should show one ACTIVE channel
docker exec fswebrtclab-freeswitch fs_cli -x "hupall"          # clean up
```

## 7. Managing the stack

```sh
docker compose logs -f freeswitch          # tail logs
docker compose restart freeswitch          # after editing freeswitch/conf/*
docker exec fswebrtclab-freeswitch fs_cli -x "reloadxml"   # reload conf without a full restart
docker exec fswebrtclab-freeswitch fs_cli   # interactive CLI
docker compose down                        # stop everything
docker compose down -v                     # also remove log/db/recordings volumes
```

Editing `freeswitch/conf/**` or `pstn-sim/conf/**` takes effect on
`reloadxml` (dialplan/directory changes) or a container restart (sip_profile
changes) -- no image rebuild needed, since conf is bind-mounted.

## 8. Adding another extension

1. Copy `freeswitch/conf/directory/default/1000.xml` to `1004.xml`, change
   the `id` and `EXT_1004_PASSWORD` references throughout.
2. Add `EXT_1004_PASSWORD=...` to `.env` and reference it in
   `freeswitch/conf/vars.xml` (copy the `ext_1000_password` `set`/`env-set`
   pair).
3. Widen the regex in `freeswitch/conf/dialplan/default/01_lab.xml`'s
   `local_extension` extension if you go outside `1000`-`1003`.
4. `docker exec fswebrtclab-freeswitch fs_cli -x "reloadxml"`.

## 9. What's explicitly out of scope (Phase 1)

Per [`INTAKE.md`](INTAKE.md) §6/§7: no dashboard yet (Phase 2), no real PSTN
trunk (Phase 1.5), no voicemail/recording, no hold music/IVR prompts (no
sound files are installed in this image on purpose -- keeps the build small
and focused on the signaling/media path).
