import { HttpError } from '@/api/client';
import { Button } from './Button';
import type { ErrorStateProps } from './types/errorState';
import styles from './ErrorState.module.css';

/**
 * A read that failed, where its rows would have been — `EmptyState`'s sibling,
 * and the difference between the two is the whole point: an empty list is a
 * fact about the workspace, a failed one is a fact about this request, and a
 * page that draws the first for the second is lying about what it holds.
 *
 * It is not `AppErrorBoundary`: that catches a throw nothing recovers from and
 * ends the app. This one is recoverable by definition, so it offers the retry.
 */
export function ErrorState({ error, onRetry, children }: ErrorStateProps) {
  return (
    <div className={styles.state} role="alert">
      <p className={styles.what}>{children}</p>
      <p className={styles.reason}>{reason(error)}</p>
      {error instanceof HttpError && <p className={styles.hint}>{NOTHING_ANSWERED}</p>}
      <Button variant="ghost" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/**
 * The one sentence this panel adds of its own, and only for `HttpError` — the
 * case where nothing answered, so there is no server sentence to defer to and
 * a bare status code is all a self-hoster would otherwise get. It is
 * `AppErrorBoundary`'s line word for word, because the two panels describe the
 * same dead server and the app should not say it in two dialects; "usually" is
 * what keeps it a hint rather than a diagnosis.
 *
 * An `ApiError` gets none of this. When the server has spoken we quote it and
 * add nothing, since a hint there would second-guess the sentence the API
 * deliberately sent.
 */
const NOTHING_ANSWERED =
  'This usually means the server is unreachable or still starting. ' +
  'Check the container logs if it keeps happening.';

/**
 * The failure in its own words, never in ours. All three of `client.ts`'s
 * kinds already carry an honest message, which is why this reads one rather
 * than mapping a status onto a guess: `ApiError` carries the server's own
 * sentence; `HttpError` — the bodiless case, a proxy or a dropped connection —
 * carries the sentence the client built from the status and nothing else;
 * `MalformedApiResponse` quotes what actually arrived.
 */
function reason(error: unknown): string {
  if (error instanceof Error) return error.message;
  // A throw that is not an `Error` has no message to read, and this panel may
  // not invent one. Saying what the thrown value was is the rule here, not a
  // stand-in for a sentence we could have had.
  return String(error);
}
