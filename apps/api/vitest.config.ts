import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

// tsc, tsup (esbuild) and tsx all read the `@/*` paths entry in tsconfig.json;
// Vitest does not, so the alias is mirrored here. Keep the two in sync.
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
