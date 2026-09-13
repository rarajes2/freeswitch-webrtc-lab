import { defineConfig } from 'vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Standalone dev server for the lab's browser softphone (docs/INTAKE.md §5).
//
// - host: true -- binds 0.0.0.0, not just localhost, so a phone/other device
//   on the same Wi-Fi can reach this via the host machine's LAN IP. Without
//   this, Vite's dev server refuses connections from anywhere but the host
//   itself (docs/DEBUGGING.md).
// - basicSsl -- `http://localhost` is a secure context by browser exemption
//   (mic access works with no HTTPS), but `http://<lan-ip>:5173` is NOT --
//   any other device needs a real secure context, hence HTTPS here too. The
//   plugin self-signs a cert on first run; your phone will need the same
//   one-time "accept the certificate" step as FreeSWITCH's own WSS port (see
//   docs/DEBUGGING.md).
export default defineConfig({
  plugins: [basicSsl()],
  server: {
    host: true,
    port: 5173,
  },
})
