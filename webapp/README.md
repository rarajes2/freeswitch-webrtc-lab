# FreeSWITCH Lab Softphone (webapp)

Standalone browser softphone -- **not** part of `docker-compose.yml` (see
[`docs/INTAKE.md`](../docs/INTAKE.md) §2/§5). Built with [SIP.js](https://sipjs.com/)
(`SimpleUser` helper) + [Vite](https://vitejs.dev/).

## Run it

```sh
cd webapp
npm install
npm run dev
```

Vite prints two URLs:

```
➜  Local:   https://localhost:5173/
➜  Network: https://<your-LAN-IP>:5173/
```

Use `Local` from the same machine; use `Network` from a phone/other device on
the same Wi-Fi. Both are HTTPS -- see "Testing from a phone" below for why
that matters and what else to expect.

## Use it (same machine)

1. Set **WSS URL** to `wss://localhost:7443` (FreeSWITCH's self-signed WSS
   port, published by `docker-compose.yml`).
2. First visit `https://localhost:7443` directly in a new tab once and accept
   the self-signed certificate warning -- browsers won't let a WebSocket
   connect through an untrusted cert without this one-time step. See
   [`docs/DEBUGGING.md`](../docs/DEBUGGING.md).
3. Set **Extension** to `1000` (or `1001`-`1003`) and **Password** to that
   extension's `EXT_100x_PASSWORD` from your `.env`.
4. Set **Domain** to your `LAB_DOMAIN` (default `fs.local`).
5. Click **Register**.
6. Dial `2000` and click **Call** to reach the simulated-PSTN echo test (you
   should hear your own voice looped back), or dial `1001`-`1003` to call
   another registered browser tab.

## Testing from a phone (or any other device on the same Wi-Fi)

Two things need to be true, and both are already handled by
`vite.config.js`/`docker-compose.yml` -- this is just what to expect:

1. **The page has to load at all.** Vite's dev server only listens on
   `localhost` unless told otherwise; `server.host: true` makes it listen on
   your machine's real network interface too, which is what lets a phone
   reach `https://<your-LAN-IP>:5173`.
2. **The page has to run in a secure context.** `http://localhost` is exempt
   from HTTPS for mic access (`getUserMedia`) and other browser APIs, but
   `http://<lan-ip>` is not -- any *other* device needs real HTTPS, which is
   why the dev server is HTTPS-everywhere now (via `@vitejs/plugin-basic-ssl`),
   not just for `localhost`.

Steps:

1. On your phone, open `https://<your-LAN-IP>:5173` and accept the
   self-signed certificate warning (same one-time step as on desktop).
2. Change **WSS URL** in the app to `wss://<your-LAN-IP>:7443` (not
   `localhost` -- the phone can't resolve that to your Mac).
3. Visit `https://<your-LAN-IP>:7443` in the same mobile browser once and
   accept *that* certificate warning too (FreeSWITCH's WSS cert, separate
   from the webapp's).
4. Register and call as above. If audio doesn't connect, check
   `EXTERNAL_RTP_IP`/`EXTERNAL_SIP_IP` in `.env` are set to that same LAN IP
   -- see [`docs/DEBUGGING.md`](../docs/DEBUGGING.md).

## Build for later deployment

```sh
npm run build
```

Outputs static files to `dist/` -- deploy them to any static host. This step
is unrelated to `docker-compose.yml`; the lab's Docker services are only
FreeSWITCH/pstn-sim/coturn.
