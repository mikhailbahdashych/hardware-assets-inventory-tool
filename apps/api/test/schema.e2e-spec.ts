import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module';
import { configureApp } from './utils/configure-app';
import { resetTestDatabase } from './utils/test-db';

describe('Database schema (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;

  beforeAll(async () => {
    await resetTestDatabase();
    const moduleFixture = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configureApp(moduleFixture.createNestApplication());
    await app.init(); // migrationsRun: true applies all migrations here
    ds = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
  });

  it('created all 8 tables plus the migrations table', async () => {
    const rows: Array<{ table_name: string }> = await ds.query(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
    );
    const names = rows.map((r) => r.table_name);
    for (const t of [
      'users',
      'refresh_tokens',
      'mfa_recovery_codes',
      'employees',
      'asset_types',
      'assets',
      'assignments',
      'audit_logs',
      'migrations',
    ]) {
      expect(names).toContain(t);
    }
  });

  it('enforces at most one open assignment per asset (partial unique index)', async () => {
    const [{ indexdef }]: Array<{ indexdef: string }> = await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_assignments_open_asset'`,
    );
    expect(indexdef).toContain('UNIQUE');
    expect(indexdef.toLowerCase()).toContain('returned_at is null');
  });

  it('has partial unique indexes on employees email and employee_number', async () => {
    const rows: Array<{ indexname: string; indexdef: string }> = await ds.query(
      `SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'employees' AND indexname LIKE 'uq_%'`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef.toLowerCase()]));
    expect(byName['uq_employees_email']).toContain('is not null');
    expect(byName['uq_employees_employee_number']).toContain('is not null');
  });

  it('enforces case-insensitive asset type names', async () => {
    const [{ indexdef }]: Array<{ indexdef: string }> = await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_asset_types_name_lower'`,
    );
    expect(indexdef).toContain('UNIQUE');
    expect(indexdef.toLowerCase()).toContain('lower');
  });

  it('seeded exactly 10 asset types', async () => {
    const [{ count }]: Array<{ count: number }> = await ds.query(
      `SELECT count(*)::int AS count FROM asset_types`,
    );
    expect(count).toBe(10);
  });

  it('uses gen_random_uuid() defaults, not uuid-ossp', async () => {
    const rows: Array<{ column_default: string | null }> = await ds.query(
      `SELECT column_default FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'id'`,
    );
    expect(rows[0].column_default).toContain('gen_random_uuid');
  });

  it('open-assignment uniqueness actually blocks a second open row', async () => {
    await ds.query(`INSERT INTO asset_types (name) VALUES ('TmpType') ON CONFLICT DO NOTHING`);
    const [{ id: typeId }]: Array<{ id: string }> = await ds.query(
      `SELECT id FROM asset_types WHERE name = 'TmpType'`,
    );
    const [{ id: assetId }]: Array<{ id: string }> = await ds.query(
      `INSERT INTO assets (asset_tag, name, asset_type_id) VALUES ('T-1', 'Test', $1) RETURNING id`,
      [typeId],
    );
    const [{ id: empId }]: Array<{ id: string }> = await ds.query(
      `INSERT INTO employees (first_name, last_name) VALUES ('A', 'B') RETURNING id`,
    );
    await ds.query(`INSERT INTO assignments (asset_id, employee_id) VALUES ($1, $2)`, [
      assetId,
      empId,
    ]);
    await expect(
      ds.query(`INSERT INTO assignments (asset_id, employee_id) VALUES ($1, $2)`, [assetId, empId]),
    ).rejects.toThrow(/uq_assignments_open_asset|duplicate key/);
  });
});
