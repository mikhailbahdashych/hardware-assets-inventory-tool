// Re-export so e2e specs keep a stable, test-local import path while the
// real implementation lives in src (shared with main.ts — no drift possible).
export { configureApp } from '../../src/configure-app';
