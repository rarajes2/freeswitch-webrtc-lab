import { defineConfig } from 'vite'

// Standalone dev server for the lab's browser softphone (docs/INTAKE.md §5).
// `http://localhost:5173` is a secure context by browser exemption, so mic
// access and WSS both work here without HTTPS -- see docs/DEBUGGING.md if
// you serve this from anywhere else.
export default defineConfig({
  server: {
    port: 5173,
  },
})
