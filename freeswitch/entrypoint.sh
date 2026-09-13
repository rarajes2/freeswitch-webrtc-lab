#!/bin/bash
# Runs as root (container default) so it can fix ownership on bind-mounted
# volumes, then execs FreeSWITCH which drops to the unprivileged `freeswitch`
# user itself via the -u/-g flags in CMD.
set -e

for dir in conf log db storage recordings conf/tls; do
    mkdir -p "/usr/local/freeswitch/$dir"
done

# Self-signed cert for WSS (what the browser webapp connects to). FreeSWITCH
# can auto-generate one itself, but only into a path derived from its
# autotools install layout that this image doesn't ship (see
# docs/INTAKE.md §2/§7) -- generate it explicitly here instead, into the
# literal path internal.xml's tls-cert-dir points at. Idempotent: skipped if
# already present (e.g. from a previous container run against the same
# mounted conf/tls). Self-signed -> browsers need a one-time manual trust
# step for a non-localhost host; see docs/DEBUGGING.md.
WSS_PEM=/usr/local/freeswitch/conf/tls/wss.pem
if [ ! -s "$WSS_PEM" ]; then
    # Must list every address a client will actually connect to in
    # subjectAltName, not just the domain -- a browser (mobile ones
    # especially) validates the cert against the literal host/IP in the wss://
    # URL. Without EXTERNAL_SIP_IP here, a phone connecting via your LAN IP
    # (which it must -- it can't resolve "localhost"/LAB_DOMAIN to your
    # machine) gets a cert that doesn't cover that address at all, and the
    # WebSocket connection is silently closed rather than showing a clickable
    # warning like a normal page load would (see docs/DEBUGGING.md).
    SAN="DNS:${LAB_DOMAIN:-freeswitch.local},DNS:localhost,IP:127.0.0.1"
    if [ -n "$EXTERNAL_SIP_IP" ] && [[ "$EXTERNAL_SIP_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        SAN="${SAN},IP:${EXTERNAL_SIP_IP}"
    fi
    echo "entrypoint: generating self-signed WSS cert at $WSS_PEM (SAN: $SAN)"
    openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
        -keyout /tmp/wss-key.pem -out /tmp/wss-cert.pem \
        -subj "/CN=${LAB_DOMAIN:-freeswitch.local}" \
        -addext "subjectAltName=$SAN" \
        2>/dev/null
    cat /tmp/wss-cert.pem /tmp/wss-key.pem > "$WSS_PEM"
    rm -f /tmp/wss-key.pem /tmp/wss-cert.pem
fi

# FreeSWITCH caches its fully-expanded XML config to speed up restarts, and
# reuses that cache whenever it looks newer than the source conf/ files. The
# image's own build-time module-integrity self-test leaves exactly such a
# cache behind (built against a different, unrelated module list) -- without
# clearing it, a *fresh* container can boot against that stale cache instead
# of the conf/ this repo actually ships. Always start clean.
find /usr/local/freeswitch -iname 'freeswitch.xml.fsxml' -delete 2>/dev/null || true

chown -R freeswitch:freeswitch \
    /usr/local/freeswitch/log \
    /usr/local/freeswitch/db \
    /usr/local/freeswitch/storage \
    /usr/local/freeswitch/recordings \
    /usr/local/freeswitch/conf/tls \
    2>/dev/null || true

exec "$@"
