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
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './vitest.setup.ts',
  },
});
