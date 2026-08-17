import type { FastifyServerOptions } from 'fastify';
import type { Config } from '@/types/config.js';

const REDACTED = '[redacted]';

/**
 * Path prefixes whose next segment is a secret. `GET /auth/invite/:token`
 * carries a raw invite token in the URL, and pino logs URLs — which would make
 * the request log the one place a raw token outlives the response that created
 * it. Everything else about the URL is worth keeping, so only the segment goes.
 */
const SECRET_PATH_PREFIXES = ['/api/v1/auth/invite/'];

/** Query parameters that are secrets wherever they appear. */
const SECRET_QUERY_KEYS = new Set(['token']);

/**
 * The URL as it is safe to log: identical, minus anything that would let the
 * reader of a log file act as somebody else.
 *
 * Deliberately not a blanket "redact long hex strings" — an asset id is a long
 * hex string, and a log that hides ids is a log nobody can debug with.
 */
export function redactSensitiveUrl(url: string): string {
  const [path = '', query] = splitOnce(url, '?');

  const prefix = SECRET_PATH_PREFIXES.find(
    (candidate) => path.startsWith(candidate) && path.length > candidate.length,
  );
  const safePath = prefix === undefined ? path : `${prefix}${REDACTED}`;

  if (query === undefined) return safePath;

  const safeQuery = query
    .split('&')
    .map((pair) => {
      const [key = '', value] = splitOnce(pair, '=');
      if (value === undefined || !SECRET_QUERY_KEYS.has(key)) return pair;
      return `${key}=${REDACTED}`;
    })
    .join('&');

  return `${safePath}?${safeQuery}`;
}

/** `String.split` with a limit keeps the tail; this drops it into one piece. */
function splitOnce(value: string, separator: string): [string, string | undefined] {
  const at = value.indexOf(separator);
  if (at === -1) return [value, undefined];
  return [value.slice(0, at), value.slice(at + separator.length)];
}

/**
 * JSON in production, because that is what log shippers read. A readable line
 * in development, because the first thing a new contributor sees should not be
 * a wall of it — `pino-pretty` is resolved by pino at runtime and is a
 * devDependency, which is exactly the set present when NODE_ENV says
 * development. Tests pass `LOG_LEVEL=silent` and get no logger at all.
 *
 * The `req` serializer is Fastify's own with the URL passed through
 * {@link redactSensitiveUrl}; `redact` covers the headers, which Fastify does
 * not log today but would carry the session cookie if anything ever did.
 */
export function loggerOptions(
  config: Config,
  destination?: NodeJS.WritableStream,
): FastifyServerOptions['logger'] {
  if (config.logLevel === 'silent') return false;

  const base = {
    level: config.logLevel,
    redact: ['req.headers.cookie', 'req.headers.authorization', 'headers.cookie'],
    serializers: {
      req(request: { id: string; method: string; url: string; ip?: string }) {
        return {
          id: request.id,
          method: request.method,
          url: redactSensitiveUrl(request.url),
          ip: request.ip,
        };
      },
    },
  };

  // A caller that named a destination gets raw JSON there: pino-pretty is a
  // transport, and a transport ignores a stream.
  if (destination) return { ...base, stream: destination };
  if (config.nodeEnv !== 'development') return base;
  return {
    ...base,
    transport: {
      target: 'pino-pretty',
      options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname', singleLine: true },
    },
  };
}
