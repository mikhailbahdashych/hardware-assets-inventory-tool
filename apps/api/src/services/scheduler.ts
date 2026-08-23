import cron from 'node-cron';
import type { FastifyBaseLogger } from 'fastify';
import type { AppDeps } from '@/types/app.js';
import type { SchedulerHandle } from '@/types/jobs.js';
import { runMaintenance, runReturnReminders, runWarrantyScan, runWeeklyDigest } from './jobs.js';

/**
 * When the jobs run. Everything in `jobs.ts` is a plain function of a date, so
 * this file decides only the clock — which is why the rules are testable and
 * this is not.
 *
 * **A missed run is skipped, never queued.** A container that was down at 08:00
 * does not send yesterday's warranty alert at noon; it sends today's tomorrow.
 * What stops a restart from re-sending is the dedupe key, not the schedule.
 *
 * Single-replica only: two containers on one volume would both fire, and only
 * the `notification_log` UNIQUE index would stand between them and duplicates.
 * That is documented in the README as a deployment constraint, not defended
 * against here.
 */
const SCHEDULE = {
  warranty: '0 8 * * *',
  returns: '5 8 * * *',
  digest: '0 8 * * 1',
  maintenance: '0 3 * * *',
} as const;

export function startScheduler(deps: AppDeps, log: FastifyBaseLogger): SchedulerHandle {
  const tasks = [
    task(SCHEDULE.warranty, 'warranty scan', async () => {
      const result = await runWarrantyScan(deps, deps.now());
      log.info(result, 'warranty scan');
    }),
    task(SCHEDULE.returns, 'return reminders', async () => {
      const result = await runReturnReminders(deps, deps.now());
      log.info(result, 'return reminders');
    }),
    task(SCHEDULE.digest, 'weekly digest', async () => {
      const result = await runWeeklyDigest(deps, deps.now());
      log.info(result, 'weekly digest');
    }),
    task(SCHEDULE.maintenance, 'maintenance', async () => {
      const result = await runMaintenance(deps, deps.now());
      log.info(result, 'maintenance');
    }),
  ];

  function task(expression: string, name: string, run: () => Promise<void>) {
    return cron.schedule(expression, () => {
      // A job that throws must not take the process with it: the next run is
      // in a day, and the log is where a self-hoster finds out why.
      run().catch((error: unknown) => log.error({ err: error }, `${name} failed`));
    });
  }

  log.info({ schedule: SCHEDULE, email: deps.mailer !== null }, 'scheduler started');
  return {
    stop: () => {
      for (const entry of tasks) void entry.stop();
    },
  };
}
