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

Open the printed `http://localhost:5173` URL (localhost is a secure context by
browser exemption, so mic access and WSS both work without HTTPS here).

## Use it

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

## Build for later deployment

```sh
npm run build
```

Outputs static files to `dist/` -- deploy them to any static host. This step
is unrelated to `docker-compose.yml`; the lab's Docker services are only
FreeSWITCH/pstn-sim/coturn.
