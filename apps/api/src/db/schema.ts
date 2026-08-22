// The schema every service imports. The tables themselves are declared once
// per dialect — `schema.sqlite.ts` and `schema.pg.ts` — and kept identical by
// `test/schema-parity.test.ts`. This file is what decides which set a running
// instance gets.
export * from './schema.sqlite.js';
