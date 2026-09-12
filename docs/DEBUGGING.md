# Debugging Guide: FreeSWITCH + WebRTC Lab

Every issue below was actually hit and fixed while building this lab (not
theoretical) -- see [`INTAKE.md`](INTAKE.md) for the design these fixes are
already baked into. Start with the general tools in §1, then jump to the
symptom that matches in §2.

## 1. General diagnostic tools

```sh
docker compose ps                                    # is everything "healthy"?
docker compose logs -f freeswitch                    # follow logs live
docker compose logs freeswitch 2>&1 | grep CRIT       # should be empty
docker exec fswebrtclab-freeswitch fs_cli             # interactive console
docker exec fswebrtclab-freeswitch fs_cli -x "sofia status"                 # profiles + gateways
docker exec fswebrtclab-freeswitch fs_cli -x "sofia status profile internal" # WSS/WS bind URLs, codecs
docker exec fswebrtclab-freeswitch fs_cli -x "sofia status gateway pstn_sim" # gateway UP/DOWN
docker exec fswebrtclab-freeswitch fs_cli -x "show channels"                 # active calls
docker exec fswebrtclab-freeswitch fs_cli -x "list_users"                    # directory sanity check
docker exec fswebrtclab-freeswitch fs_cli -x "sofia profile internal siptrace on"  # raw SIP trace (verbose)
```

Validate any XML you hand-edit **before** restarting/reloading:

```sh
xmllint --noout freeswitch/conf/**/*.xml pstn-sim/conf/**/*.xml
```

## 2. Symptom → cause → fix

### Config edits don't seem to do anything -- FreeSWITCH loads profiles/gateways/users you never defined

**Symptom:** `sofia status` shows profiles like `internal-ipv6`,
`external-ipv6`, a gateway named `example.com`, or modules failing to load
that you never listed in `modules.conf.xml` (`mod_verto`, `mod_signalwire`,
`mod_conference`, ...).

**Cause:** FreeSWITCH's autotools install layout (`./configure
--prefix=/usr/local/freeswitch`) writes its own full default ("vanilla")
sample config to `/usr/local/freeswitch/etc/freeswitch` -- a *different*
directory from `/usr/local/freeswitch/conf`. Without an explicit `-conf`
flag, FreeSWITCH reads `etc/freeswitch`, not your bind-mounted `conf/`, and
none of your real config is ever consulted.

**Fix (already applied here):** the Dockerfile's `CMD` passes `-conf
/usr/local/freeswitch/conf -log /usr/local/freeswitch/log -db
/usr/local/freeswitch/db` explicitly (FreeSWITCH requires all three or none),
and the Dockerfile deletes `etc/freeswitch` at build time so it can't be
accidentally used. If you ever change the `CMD`/entrypoint, keep all three
`-conf`/`-log`/`-db` flags together.

### `reloadxml`/a fresh container silently keeps old settings

**Cause:** FreeSWITCH caches its fully-expanded XML to
`<log_dir>/freeswitch.xml.fsxml` and reuses it if it looks newer than your
source files. A build-time self-test can leave a stale one behind.

**Fix (already applied here):** `entrypoint.sh` deletes any
`freeswitch.xml.fsxml` it finds before starting FreeSWITCH. If you're still
seeing stale behavior after editing conf and restarting, delete it manually:

```sh
docker exec fswebrtclab-freeswitch find /usr/local/freeswitch -iname 'freeswitch.xml.fsxml' -delete
docker compose restart freeswitch
```

### `Cannot Initialize [[error near line N]: unclosed <!--]` at startup, or FreeSWITCH won't start at all

**Cause:** an XML comment somewhere contains a literal `--` (double hyphen).
This is invalid XML (`<!-- like this -- see -->` breaks the parser), and
FreeSWITCH's preprocessor doesn't fail loudly and stop at *your* file -- it
silently falls through and mixes in module-embedded defaults, producing
exactly the "phantom vanilla config" symptom above as a side effect.

**Fix:** `xmllint --noout` every file you touch (see §1) before restarting.
Never write ` -- ` in a comment; use ` - ` or an em dash instead.

### ESL / `fs_cli` can't connect (`Error Connecting`)

**Cause:** usually the same XML-corruption issue above (an unrelated broken
comment can knock out `mod_event_socket`'s config and it falls back to
binding `::` instead of `0.0.0.0`, which then fails inside the container).
Check `docker compose logs freeswitch | grep -i event_socket` for `Cannot
get information about IP address ::`.

**Fix:** fix the underlying XML (see above), or confirm the ESL password you're
passing matches `ESL_PASSWORD` in `.env` (default `ClueCon`):
`fs_cli -p <password> -x status`.

### Module fails to load: `mod_local_stream.so ... Module load routine returned an error`

**Cause:** `mod_local_stream` requires at least one `<directory>` entry in
its config; this lab ships no sound files (out of scope, see
[`INTAKE.md`](INTAKE.md) §7), so an empty config makes the module fail to
init. It's been removed from `modules.conf`/`modules.conf.xml` entirely for
that reason -- if you re-add it, either point it at real sound files or leave
it out.

### No WSS cert / browser can't even open a TLS connection to 7443

**Cause:** the same `etc/freeswitch` vs `conf` split above also affects
`$${certs_dir}` (FreeSWITCH computes it from the *unused* `etc/freeswitch`
path). `internal.xml`'s `tls-cert-dir` is set to the literal path
`/usr/local/freeswitch/conf/tls` for exactly this reason, and
`entrypoint.sh` generates a self-signed `wss.pem` there on first start if one
isn't already present.

**Fix if it's still missing:** check `docker exec fswebrtclab-freeswitch ls
/usr/local/freeswitch/conf/tls/` -- if empty, check `docker compose logs
freeswitch | grep openssl` for an error, or just delete the (empty)
`freeswitch/conf/tls/` directory on the host and restart the container.

### Browser won't connect over WSS (silently fails, or a console error about a bad certificate)

**Cause:** the cert is self-signed (a documented tradeoff for local dev, see
[`INTAKE.md`](INTAKE.md) §7) -- browsers refuse a WebSocket handshake through
an untrusted cert with no way to click through it from the WS connection
itself.

**Fix:** visit `https://localhost:7443` (or `https://<your-LAN-IP>:7443`)
directly in the same browser first, and accept the certificate warning. This
is a one-time step per browser profile. For a demo/production deployment,
swap in a real cert (Let's Encrypt via a reverse proxy) instead -- see
[`INTAKE.md`](INTAKE.md) §7.

### Registration works but calls have no audio ("no audio" / one-way audio)

**Cause:** almost always `EXTERNAL_RTP_IP`/`EXTERNAL_SIP_IP` (in `.env`) not
matching a real, reachable address. If left at `127.0.0.1` while the browser
and FreeSWITCH aren't the literal same machine/network namespace, the SDP
advertises an address the browser's ICE stack can never reach.

**Fix:** set both to your machine's real LAN IP
(`ipconfig getifaddr en0` on macOS) in `.env`, then `docker compose restart
freeswitch`. Confirm with:

```sh
docker exec fswebrtclab-freeswitch fs_cli -x "sofia status profile internal" | grep -i "ext-"
```

### A `bridge` to an unregistered `user/X@domain` hangs the call up immediately instead of falling through

**Cause:** FreeSWITCH's default dialplan behavior continues to the next
action after a *soft* bridge failure (busy, no answer, timeout) -- but a
bridge that can't even build a dial string (no registered contact at all)
raises `MANDATORY_IE_MISSING`, which is treated as fatal and hangs up the
channel instead of falling through, unless `continue_on_fail=true` is set
first. `pstn-sim`'s inbound dialplan
(`pstn-sim/conf/dialplan/public/01_inbound.xml`) sets this explicitly before
attempting to bridge to `user/2000@...` -- keep this pattern if you add
similar "ring a phone, fall back to X" extensions.

### macOS/Docker Desktop: TURN (coturn) or FreeSWITCH's RTP isn't reachable from a real device

**Cause:** `network_mode: host` does not expose a container on the Mac's real
network interface the way it does on Linux under Docker Desktop -- it only
reaches other things inside the Docker Desktop VM.

**Fix (already applied here):** `docker-compose.yml` uses bridge networking
with explicit `ports:` publishing for both `freeswitch` and `coturn`,
never `network_mode: host`, specifically because of this. If you deploy to a
real Linux host later, host networking becomes a valid (and often simpler)
alternative -- but re-verify port publishing either way.

### `docker exec ... fs_cli` reports the right gateway/profile but a *browser* call still fails

Turn on SIP tracing and watch the raw messages:

```sh
docker exec fswebrtclab-freeswitch fs_cli -x "sofia profile internal siptrace on"
docker compose logs -f freeswitch
# ... place the call from the browser ...
docker exec fswebrtclab-freeswitch fs_cli -x "sofia profile internal siptrace off"
```

Also check the browser's own devtools console/network tab for the WebSocket
connection status and any `getUserMedia` permission errors.
