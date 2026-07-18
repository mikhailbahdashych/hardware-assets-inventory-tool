// Forces every e2e run onto the throwaway test database BEFORE any module
// (including data-source.ts) reads process.env.
process.env.POSTGRES_DB = 'inventory_test';
// Throttling off by default in e2e (serial specs share one IP); the dedicated
// throttle spec re-enables it for its own TestingModule.
process.env.THROTTLE_DISABLED = 'true';
