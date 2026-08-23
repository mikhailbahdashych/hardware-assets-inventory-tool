import { defineConfig } from 'drizzle-kit';

// The SQLite half. `drizzle.pg.config.ts` is the other one — a schema change
// means generating both.
export default defineConfig({
  schema: './src/db/schema.sqlite.ts',
  out: './src/migrations',
  dialect: 'sqlite',
});
