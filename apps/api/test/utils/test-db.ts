import { Client } from 'pg';

/** Drops and recreates the public schema of inventory_test for a clean slate. */
export async function resetTestDatabase(): Promise<void> {
  const client = new Client({
    host: process.env.POSTGRES_HOST ?? 'localhost',
    port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
    database: 'inventory_test',
    user: process.env.POSTGRES_USER ?? 'inventory',
    password: process.env.POSTGRES_PASSWORD ?? 'inventory',
  });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  } finally {
    await client.end();
  }
}
