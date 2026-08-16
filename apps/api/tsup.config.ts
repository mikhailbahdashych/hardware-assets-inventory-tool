import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Workspace source is inlined; native modules stay external runtime deps.
  noExternal: [/@inventory\/shared/],
  external: ['better-sqlite3', '@node-rs/argon2'],
});
