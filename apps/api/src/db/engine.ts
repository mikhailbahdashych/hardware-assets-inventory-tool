import type { Engine } from '@/types/config.js';

/**
 * Which engine this process runs on, decided once when this module loads.
 *
 * **Why the environment directly and not `config.engine`.** `db/schema.ts`
 * has to answer "which tables" before any service module finishes importing —
 * a table is a module-scope constant, and every service names one at the top
 * of its file. `loadConfig()` runs later, in `index.ts` or a test helper, by
 * which time the tables have long since been chosen. So this reads the variable
 * raw and `src/config.ts` validates the same variable properly a moment later:
 * `DATABASE_URL` must be a `postgres://` or `postgresql://` URL, and a boot
 * with anything else in it stops there. The two cannot disagree about which
 * engine is running, because they read the one variable.
 *
 * Everything outside `db/` asks `config.engine` instead.
 */
export const ENGINE: Engine = process.env.DATABASE_URL ? 'postgres' : 'sqlite';
