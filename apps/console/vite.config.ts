import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// PROVISIONAL dev target until the `maxim serve` skeleton pins port + base paths
// (pymaxim Phase-0 deliverable). Dev-tooling override only — operator config
// stays in pymaxim's config.json, never env vars.
const serveUrl = process.env.MAXIM_SERVE_URL ?? 'http://127.0.0.1:8765'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    manifest: true,
  },
  server: {
    proxy: {
      '/api': serveUrl,
      '/ws': { target: serveUrl, ws: true },
    },
  },
  test: {
    name: 'console',
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
  },
})
