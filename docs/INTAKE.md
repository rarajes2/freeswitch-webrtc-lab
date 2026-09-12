# Intake: FreeSWITCH + WebRTC Lab

Status: **Phase 1 implemented and verified** (see [USER_MANUAL.md](USER_MANUAL.md), [DEBUGGING.md](DEBUGGING.md)) · Last updated: 2026-09-12

## 1. Overview & Goals

Build a self-contained, Dockerized lab that demonstrates a full FreeSWITCH-based calling stack:

- A **FreeSWITCH server** that:
  - handles **SIP registration** for softphone/WebRTC extensions,
  - works as a **media server** (RTP/SRTP, transcoding between legs),
  - performs **PSTN routing and bridging** (initially simulated, real trunk optional later),
  - supports **WebRTC calling** from a browser.
- A **WebRTC web app** (browser softphone, run as a normal standalone app — not containerized) to make/receive calls through FreeSWITCH.
- A **Phase 2 management dashboard** for registrations, active calls, CDRs, and gateway status.

**Hard constraint:** no SignalWire hosted token/password auth, and no SignalWire-branded artifact in the stack at all. Concretely, this means:
- Extension/trunk authentication uses FreeSWITCH's own **directory XML** (per-user SIP passwords) and **`mod_acl`** ACLs — not a cloud-issued token.
- The PSTN "gateway" is configured with standard, provider-agnostic SIP trunk credentials (username/password register, or static IP-ACL trunking) — not a SignalWire project/token pair.
- The FreeSWITCH Docker image is **built from source** rather than using the prebuilt `signalwire/freeswitch` image — see §2 "FreeSWITCH image: build from source."

## 2. Architecture / Topology

### Docker Compose services

| Service | Role | Notes |
|---|---|---|
| `freeswitch` | Core PBX/media server | `mod_sofia` internal profile (SIP reg + WSS/WebRTC) + external profile (PSTN gateway), dialplan, directory, ESL |
| `pstn-sim` | Simulated PSTN peer | A second FreeSWITCH (or scripted SIP UA) instance that registers/is dialed as a fake "carrier," so routing/bridging can be proven with zero real trunk cost |
| `coturn` | STUN/TURN | NAT traversal for browser WebRTC clients — TURN is treated as required, not optional (see §7) |
| `reverse-proxy` | TLS + WSS termination | Traefik (preferred) or nginx; terminates TLS for FreeSWITCH's WSS signaling endpoint |
| `dashboard-api` *(Phase 2)* | ESL client + CDR ingestion | Backing API for the dashboard |
| `dashboard-ui` *(Phase 2)* | Dashboard frontend | Registrations / channels / CDRs / gateway status |

**The webapp is not containerized.** It's a normal standalone app (e.g. run via `npm run dev`/Vite locally during development; later built to static files and deployed independently of this Compose stack, on any static host) that connects to the FreeSWITCH reverse-proxy's WSS endpoint over the network. Because of the WebRTC secure-context requirement (§5), local dev over `http://localhost` is exempt from the HTTPS requirement, but anything beyond localhost still needs the app itself served over HTTPS — independently of however FreeSWITCH's own WSS is terminated.

### FreeSWITCH image: build from source

The FreeSWITCH container is **built from source** via a multi-stage Dockerfile, not the prebuilt `signalwire/freeswitch` image:

- **Builder stage** (`debian:bookworm-slim` + `build-essential`, `autoconf`, `automake`, `libtool`, `pkg-config`, `git`, plus FreeSWITCH's library deps — `libssl-dev`, `libpcre2-dev`, `libedit-dev`, `libsqlite3-dev`, `libcurl4-openssl-dev`, `libopus-dev`, `libsndfile1-dev`, `libspeexdsp-dev`, `libldns-dev`): build the three prerequisite libraries first, in order — `libks`, `sofia-sip`, `spandsp` — then clone `github.com/signalwire/freeswitch` (this is just where the upstream open-source repo lives; cloning source is not a dependency on SignalWire's hosted service) pinned to an **exact release tag** (e.g. `v1.10.12`), never a moving branch.
- **Trim `modules.conf`** to what the lab needs before `./configure && make && make install` — roughly `mod_sofia`, `mod_commands`, `mod_dialplan_xml`, `mod_event_socket`, `mod_json_cdr`, `mod_cdr_csv`, `mod_sndfile`, `mod_native_file`, `mod_tone_stream`, `mod_local_stream`, `mod_console`, `mod_logfile`, and codec modules for Opus/G.711/G.722. FreeSWITCH ships 100+ modules by default; cutting to ~15–20 meaningfully shortens build time and final image size.
- **Runtime stage**: fresh `debian:bookworm-slim` with only runtime shared-library dependencies (no compiler toolchain), `COPY --from=builder /usr/local/freeswitch /usr/local/freeswitch`, a non-root `freeswitch` user, ports from the table above, entrypoint `freeswitch -nonat -nc`.
- **Build time/caching**: a from-scratch build of libks+sofia-sip+spandsp+FreeSWITCH typically takes 10–20 minutes; order Dockerfile layers so the apt-get/library-build steps cache separately from the FreeSWITCH source checkout, so editing `conf/` later doesn't force a full rebuild.
- `pstn-sim` reuses the same built image with a different mounted `conf/`, avoiding a second from-scratch build.

### Networking

- **RTP port range:** narrow FreeSWITCH's default 16384–32768 down to something like **16384–16584** (~100 ports) so it's manageable to publish under bridge networking.
- **macOS dev caveat:** this lab's dev machine is macOS (Docker Desktop). `network_mode: host` behaves like Linux host networking only on Linux — on macOS it does **not** expose the container on the LAN interface. So: **use bridge mode with explicit `ports:` ranges, plus `external_rtp_ip`/`external_sip_ip` set to the host's LAN IP**, for this environment. A Linux demo/prod host can switch to `host` networking instead.
- **NAT/external IP:** `vars.xml` must set `external_rtp_ip` / `external_sip_ip` (static IP or STUN auto-discovery) so SDP/ICE candidates reflect a reachable address, not the container's internal bridge IP. This is the single most common "call connects, no audio" failure mode — treat it as a first-class config item.
- **WSS termination:** recommended default is the reverse proxy terminates TLS (443) and proxies to FreeSWITCH's plain `ws-binding` (5066) over the internal Docker network — one cert covers both the web app and signaling. FreeSWITCH's own `wss-binding` (7443, self-terminated TLS) is documented as the alternative for a proxy-free topology.
- **coturn ports:** 3478 (STUN/TURN, udp+tcp), 5349 (TURNS), plus a narrowed relay range (e.g. 49152–49352) for lab scale.

## 3. FreeSWITCH Configuration Scope

| File | Purpose |
|---|---|
| `conf/vars.xml` | Domain, default extension password seed, `external_rtp_ip`/`external_sip_ip`, port vars |
| `conf/sip_profiles/internal.xml` | SIP registration profile; `ws-binding` (5066) / `wss-binding` (7443) for WebRTC; `rtp-secure-media` for DTLS-SRTP; `apply-inbound-acl` |
| `conf/sip_profiles/external.xml` | External/PSTN-facing profile (port 5080), includes gateway files |
| `conf/sip_profiles/external/pstn_sim.xml` | The simulated-PSTN gateway — **this exact file's shape is the swap point** for a real carrier later (same fields, different `proxy`/`register`/`realm`/ACL) |
| `conf/directory/default/*.xml` | Per-extension users (1000–1099) — SIP and WebRTC clients are the same user type, transport is just a detail |
| `conf/dialplan/default/*.xml` | Internal context: ext↔ext bridging, ext→gateway (`bridge:sofia/gateway/pstn_sim/${destination_number}`) |
| `conf/dialplan/public/*.xml` | **Inbound** context: routes calls arriving from the gateway leg back to an internal extension — commonly missed, called out explicitly here |

**Codecs:** `OPUS,G722,PCMU,PCMA` — Opus for WebRTC legs, G.711 (PCMU/PCMA) for PSTN legs. FreeSWITCH transcodes automatically per-leg **as long as `bypass_media`/`proxy_media` stay off** on any call touching a WebRTC leg (those flags would skip FreeSWITCH's media core entirely and break both transcoding and DTLS termination).

**CDR groundwork (for Phase 2):** `mod_json_cdr` posting JSON to an HTTP ingestion endpoint is the recommended mechanism; `mod_cdr_csv` is a zero-config fallback already on by default.

**ESL (Event Socket Library):** port 8021, used later by the Phase 2 dashboard (`show registrations`, `show channels`, `sofia status gateway <name>`, `originate`). Default password `ClueCon` **must be changed** before any exposure beyond `localhost`, and this port must **never** be published to the host or public network — the dashboard container talks to it over the internal Docker network only.

## 4. Security Model (native FreeSWITCH auth, no hosted tokens)

- **Per-extension auth:** strong, randomly generated SIP passwords in directory XML — never FreeSWITCH's sample defaults. This *is* the native replacement for a hosted token system.
- **ACLs (`mod_acl`):** applied via `apply-inbound-acl` on both SIP profiles; the external/PSTN profile's ACL is the control that, once a real trunk is added, allow-lists only the carrier's signaling IPs.
- **PSTN gateway auth — two native, provider-agnostic patterns** (both explicitly non-token):
  1. SIP REGISTER with username/password (`register="true"`), for carriers that require registration.
  2. Static IP-based trunking (`register="false"` + ACL allow-list), for carriers that support it (e.g. Telnyx, Flowroute, Bandwidth).
- **Brute-force protection:** FreeSWITCH has no built-in equivalent to fail2ban — plan an external `fail2ban` jail matching `SIP auth failure` lines in `freeswitch.log` as a documented add-on, not an assumed default.
- **WebRTC transport:** DTLS-SRTP is mandatory by the WebRTC spec regardless of server setting; set `rtp-secure-media=mandatory` once past initial bring-up, and only expose WSS (not plain WS) outside `localhost`.
- **Exposed port checklist:** 5060/5061 (SIP, only if external SIP UAs are wanted — not required for browser-only), 7443 or reverse-proxy 443 (WSS), 16384–16584 (RTP), 3478/5349 + relay range (coturn). **8021 (ESL) is never published.**
- **Secrets management:** `.env` (git-ignored) + `.env.example` (committed, placeholder values); no plaintext passwords/carrier credentials in tracked XML — render directory/gateway XML from env vars at container start (entrypoint template step).

## 5. WebRTC Web App Design

- **Deployment:** standalone app, not a Docker service — run locally via a dev server (e.g. Vite) during development, and later built to static files that can be deployed independently (any static host) once past the lab stage.
- **Stack:** **SIP.js** (`SimpleUser` helper) as the primary library — actively maintained, TypeScript-friendly, much less boilerplate than hand-rolling `UserAgent`/`Inviter`/`Invitation`. **JsSIP** is a valid lower-level alternative; pick one owner library for Phase 1 rather than splitting effort.
- **Registration:** `wss://<proxy-host>/ws` (proxied to FreeSWITCH) or `wss://<host>:7443` (direct); SIP URI `sip:1000@<domain>`, same password as the directory entry.
- **Call flow:** originate (dial pad), answer incoming (ringing UI, accept/reject), hold/resume (re-INVITE), transfer (REFER), hangup (BYE/CANCEL).
- **TURN credentials:** fed into SIP.js's `iceServers` config from coturn; static long-term credentials are fine at lab scale, TURN REST API (time-limited credentials) recommended once hardened.
- **Minimal UI:** dial pad, registration status indicator, active-call panel (mute/hold/hangup/transfer), incoming-call toast, mic-permission handling with a clear denied-permission fallback.
- **Secure-context requirement (hard constraint):** `getUserMedia` and non-mixed-content WSS both require a secure context — `localhost` is exempt, anything else needs real HTTPS. This is why the reverse-proxy TLS design in §2 isn't optional once the app is accessed from a non-localhost host.

## 6. Phase 2 Dashboard

| Option | Pros | Cons |
|---|---|---|
| **FusionPBX** | Turnkey, mature, DB-backed (`mod_xml_curl`) config generation, covers everything asked for out of the box | Takes over config generation entirely — Phase 1's hand-authored XML would need remodeling into its schema; heavy dependency (own DB, own auth) for what's meant to stay a teaching lab |
| **Custom lightweight dashboard (recommended)** | Small ESL-backed service (Node `modesl` or Python `ESL.py`/`greenswitch`) exposing `show registrations`/`show channels`/`sofia status gateway`; CDR history via `mod_json_cdr` → SQLite/Postgres; keeps git-tracked XML as the single source of truth | Config editing is a guarded "edit file → `reloadxml`" flow, not fully dynamic — acceptable trade-off for a lab |

**Recommendation:** custom lightweight dashboard. `mod_xml_curl`-based dynamic config is noted as a possible future stretch goal, not a Phase 2 requirement.

## 7. Gap Analysis / Open Questions / Risks

The original feature list didn't specify the following; each has a proposed default so this stays actionable rather than a list of blockers.

| Gap | Proposed default |
|---|---|
| Codec/interop mismatch (WebRTC mandates Opus+DTLS-SRTP, PSTN is typically plain G.711) | Handled automatically by FreeSWITCH's per-leg transcoding — **only if `bypass_media`/`proxy_media` stay off** on mixed calls; make this an explicit dialplan rule, not an assumption |
| NAT traversal depth | STUN alone is insufficient behind symmetric NAT/corporate firewalls — **TURN (coturn) is required, not optional**; test explicitly with a forced-relay browser flag in Phase 1.5 |
| WSS certificate / mixed content | Self-signed certs need a one-time manual browser trust step (common lab stumbling block); document both self-signed (dev default) and Let's Encrypt via Traefik (demo, needs a real domain) |
| Numbering / DID plan | `1000–1099` internal WebRTC/SIP extensions, `2000–2099` simulated-PSTN numbers on `pstn-sim`, reserved DID-to-extension map introduced when a real trunk is added |
| Capacity / scaling | Lab-scale only (tens of concurrent calls); the real constraint is RTP port-range sizing under bridge networking on macOS, not CPU — don't over-engineer this |
| Config persistence model | XML files as source of truth (git-tracked, secrets externalized via `.env`) for Phase 1/2; CDRs flow out via `mod_json_cdr` into a small DB for dashboard reads only — explicitly not `mod_xml_curl`-backed dynamic config yet |
| Testing / validation plan | SIPp XML scenarios for scripted SIP-side registration/call tests; Playwright driving two headless Chrome instances (`--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`) for an end-to-end WebRTC↔WebRTC call; ESL `show channels`/`show registrations` as the ground-truth oracle both compare against |
| Logging / observability | Baseline: `freeswitch.log` bind-mounted + `docker logs`; optional stretch: `freeswitch_exporter` for Prometheus (registration/channel-count metrics) — not required for lab goals |
| Dev vs. demo environment separation | `docker-compose.yml` + `docker-compose.dev.yml` / `docker-compose.demo.yml` overrides; differing `.env`, differing cert strategy, differing `external_rtp_ip` |
| Recording / voicemail | **Explicitly out of scope for Phase 1** pending confirmation — `mod_voicemail` and `record_session` are trivially available later if wanted |
| ESL exposure risk | Named risk: when the Phase 2 dashboard container is added, it's easy to accidentally publish 8021 to the host — must stay internal-network-only |

**Resolved:** FreeSWITCH image is built from source (§2), not the prebuilt `signalwire/freeswitch` image — no SignalWire-branded artifact anywhere in the stack. The webapp runs as a standalone (non-Docker) app (§2, §5).

**Still owed from the user for full sign-off:**
1. If/when a real PSTN trunk is added in Phase 1.5, which provider (Telnyx, Flowroute, VoIP.ms, Bandwidth, other)?
2. Is voicemail/call recording actually out of scope, or should it be planned for later?
3. For a demo (non-localhost) deployment, is there a real domain available for Let's Encrypt, or should self-signed certs + documented browser trust step be the permanent answer?

## 8. Phased Delivery Plan

### Phase 1 — SIP registration + WebRTC calling + simulated PSTN bridging
- Docker services: `freeswitch` (built from source), `pstn-sim`, `coturn`, `reverse-proxy`
- Standalone (non-Docker): the webapp, run via a local dev server
- FreeSWITCH: internal profile w/ WSS, 4+ test extensions, ext↔ext and ext↔gateway dialplan, `pstn_sim` gateway + `public` context inbound routing
- Web app: SIP.js dial pad; register; call between two browser extensions; call to/from `pstn-sim`
- **Acceptance:** two browsers register and complete a two-way-audio call; a browser call reaches `pstn-sim`; `pstn-sim` calls back into an internal extension via the `public` dialplan context

### Phase 1.5 — real trunk swap-in, TURN hardening, security hardening
- Add a second gateway XML for a real provider, IP-ACL or register-based auth, values sourced from `.env`
- coturn: long-term credential mechanism / TURN REST API, narrowed relay range, TURNS
- Security: generated (non-default) extension passwords, tightened ACLs, fail2ban wired to `freeswitch.log`, real TLS certs, ESL password rotated, firewall rules documented per exposed port
- **Acceptance:** outbound call reaches a real PSTN number; inbound DID routes to an internal extension; TURN relay verified under a forced-relay network test

### Phase 2 — lightweight dashboard
- Custom backend (Node/`modesl` or Python/ESL) + `mod_json_cdr` ingestion into SQLite/Postgres
- Views: live registrations, active channels, CDR history, gateway status; guarded XML-edit + `reloadxml`
- **Acceptance:** dashboard registration/channel view matches `fs_cli` ground truth; CDR list matches actual call history; gateway status reflects real up/down/registered state

---

*This document defines scope only — no `docker-compose.yml`, FreeSWITCH config, or app code is created yet. Implementation starts once this intake is reviewed and the open questions in §7 are answered.*
