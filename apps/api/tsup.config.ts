import { defineConfig } from 'tsup';

export default defineConfig({
  // The demo seeder ships too: a hosted demo restores itself by running it
  // inside the container, which only has the built output.
  entry: ['src/index.ts', 'src/db/seed-demo-cli.ts', 'src/db/mfa-reset-cli.ts'],
  format: 'esm',
  target: 'node22',
  clean: true,
  sourcemap: true,
  // Workspace source is inlined; native modules stay external runtime deps.
  noExternal: [/@inventory\/shared/],
  external: ['better-sqlite3', '@node-rs/argon2'],
});
