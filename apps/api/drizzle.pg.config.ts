import { defineConfig } from 'drizzle-kit';

// The Postgres half of the schema, and its own checked-in migration folder.
// Two dialects cannot share generated SQL, so they do not share a folder:
// `npm run db:generate` writes src/migrations/, `db:generate:pg` writes
// src/migrations-pg/, and a schema change means running both.
export default defineConfig({
  schema: './src/db/schema.pg.ts',
  out: './src/migrations-pg',
  dialect: 'postgresql',
});
