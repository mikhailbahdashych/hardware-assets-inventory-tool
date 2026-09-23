import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  // Mirrors the `@/*` paths entry in tsconfig.json. Vitest reads this file too,
  // so tests resolve the alias through the same config.
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    // Localhost by default: a dev server on every interface hands an
    // un-set-up instance to whoever else is on the coffee-shop wifi. The
    // Docker dev stack sets VITE_HOST=0.0.0.0, because there the container
    // boundary is what a request has to cross to arrive at all.
    host: process.env.VITE_HOST ?? 'localhost',
    proxy: {
      // The slash is load-bearing: a proxy key matches by prefix, so `/api`
      // also caught `/api-tokens` — a client route that merely begins with the
      // same letters — and handed a reload of that page to the API, which
      // answered 404 JSON. The API's namespace is everything under `/api/`,
      // and nothing else. (`plugins/static-spa.ts` is the same rule server-side;
      // there is no test harness for this file, so this comment is the net.)
      '/api/': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
  },
});
