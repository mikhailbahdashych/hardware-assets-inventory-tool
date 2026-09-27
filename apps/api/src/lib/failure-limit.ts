import type { FailureLimit, RateWindow } from '@/types/auth.js';
import { AppError } from './errors.js';

/**
 * Past this many keys the expired ones are swept on the next charge, so an
 * instance that has met a great many addresses does not remember them all.
 */
const SWEEP_AT = 10_000;

/**
 * A fixed window per key that only failures use up. `@fastify/rate-limit`
 * counts every request and has no way to give one back, so on the sign-in
 * routes ten colleagues behind one office NAT signing in successfully locked
 * the eleventh out — the limit exists to slow guessing, and a right answer is
 * not a guess.
 *
 * In memory and per process, exactly like the plugin's default store it
 * replaces on these routes. ponytail: one process's memory; a shared store
 * (Redis) the day this runs as more than one replica behind one address.
 */
export function failureLimit(window: RateWindow, clock: () => number = Date.now): FailureLimit {
  const buckets = new Map<string, { spent: number; resetAt: number }>();

  return {
    charge(key) {
      const now = clock();
      if (buckets.size >= SWEEP_AT) {
        for (const [stale, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(stale);
      }
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) {
        bucket = { spent: 0, resetAt: now + window.timeWindow };
        buckets.set(key, bucket);
      }
      if (bucket.spent >= window.max) {
        throw new AppError(429, 'rate_limited', 'Too many attempts — try again later.');
      }
      bucket.spent += 1;
    },
    refund(key) {
      const bucket = buckets.get(key);
      if (bucket && bucket.spent > 0) bucket.spent -= 1;
    },
  };
}
