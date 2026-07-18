// Forces every e2e run onto the throwaway test database BEFORE any module
// (including data-source.ts) reads process.env.
process.env.POSTGRES_DB = 'inventory_test';
