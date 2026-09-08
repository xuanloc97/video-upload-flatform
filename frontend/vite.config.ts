/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config for the React SPA.
 *
 * In dev, `/graphql`, `/health`, and `/files` are proxied to the backend so the browser talks to a
 * single origin (mirroring the production Ingress path routing). The GraphQL client and file URLs
 * therefore use same-origin relative paths in both dev and prod.
 */
const BACKEND = process.env.BACKEND_ORIGIN ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/graphql': { target: BACKEND, changeOrigin: true },
      '/files': { target: BACKEND, changeOrigin: true },
      '/health': { target: BACKEND, changeOrigin: true },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // The repo lives on a slow /mnt/d Windows mount under WSL; give async findBy* queries (which
    // await Apollo query resolution) generous headroom so tests are not flaky under load.
    testTimeout: 30000,
  },
});
