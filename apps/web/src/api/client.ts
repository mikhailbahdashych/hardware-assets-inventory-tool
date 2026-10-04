import type { ApiErrorBody, ApiErrorEnvelope } from '@inventory/shared';
import type { ApiRequest } from '@/types/api';

const API_BASE = '/api/v1';

/** A non-2xx response, carrying the server's `{ error: { code, message, fields? } }` envelope. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * A failing response that carried no usable body — a proxy, a gateway or a
 * dropped connection, never this API answering. Every field is read off the
 * response, so nothing is invented: `http_502` and its sentence name the
 * status and claim nothing else.
 */
export class HttpError extends ApiError {
  constructor(
    status: number,
    // Overridden only by `ServerUnreachable`, which has no status to read.
    code = `http_${status}`,
    message = `The request failed with HTTP ${status}.`,
  ) {
    super(status, code, message);
    this.name = 'HttpError';
  }
}

/**
 * No response at all: `fetch` itself rejected — the server is down, the
 * network dropped, a proxy refused the connection. The browser's own words
 * for that ("Failed to fetch", "NetworkError when attempting…", "Load
 * failed") differ per engine and say nothing a self-hoster can act on, so
 * this says what is known and keeps theirs as the `cause`.
 *
 * It is the bodiless kind taken to its end — nothing answered at all — so it
 * is an `HttpError`, and `ErrorState` and `AppErrorBoundary` give it the same
 * server-unreachable hint without learning a fourth class. Status 0 is what
 * the platform reports for a request that never got one.
 */
export class ServerUnreachable extends HttpError {
  constructor(cause: unknown) {
    super(0, 'unreachable', 'The server could not be reached.');
    this.name = 'ServerUnreachable';
    this.cause = cause;
  }
}

/**
 * The API answered, but not in the shape it documents. Making up a code and a
 * message here would let a broken endpoint keep running in disguise, so this
 * says what actually arrived instead.
 */
export class MalformedApiResponse extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MalformedApiResponse';
  }
}

export function apiFetch<T = unknown>(path: string, options: ApiRequest = {}): Promise<T> {
  return send<T>(`${API_BASE}${path}`, options);
}

/**
 * A read from the public surface's root rather than from `/api/v1`. The app
 * reads exactly one thing there — the generated manual the API reference page
 * renders — and it goes through the same failure handling as every other read:
 * that surface answers in the same envelope. No token is sent, because the
 * document names no scope; a cookie rides along like on any same-origin
 * request, and the public surface never looks at one.
 */
export function publicApiFetch<T = unknown>(path: string): Promise<T> {
  return send<T>(`/api/public${path}`, {});
}

async function send<T>(url: string, options: ApiRequest): Promise<T> {
  const { method = 'GET', body, signal } = options;

  const response = await request(url, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const payload = await readJson(response);
  if (!response.ok) throw toApiError(response, payload);
  return payload as T;
}

/**
 * Multipart upload. The browser sets the multipart boundary itself, so this
 * deliberately sends no content-type header of its own.
 */
export async function apiUpload<T = unknown>(path: string, body: FormData): Promise<T> {
  const response = await request(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    body,
  });
  const payload = await readJson(response);
  if (!response.ok) throw toApiError(response, payload);
  return payload as T;
}

/**
 * `fetch`, with its one rejection that is not ours to pass on translated: a
 * request nothing answered becomes `ServerUnreachable`. An abort is the
 * caller's own doing — TanStack cancelling a query it no longer needs — and
 * goes through untouched.
 */
async function request(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (error) {
    if (init.signal?.aborted) throw error;
    throw new ServerUnreachable(error);
  }
}

/** Narrows a parsed body to the error envelope, or reports that it is not one. */
function readErrorEnvelope(payload: unknown): ApiErrorBody | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const { error } = payload as Partial<ApiErrorEnvelope>;
  if (typeof error !== 'object' || error === null) return null;
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return null;
  return error;
}

function toApiError(response: Response, payload: unknown): ApiError {
  // Nothing came back that this API could have written, so report the status
  // and only the status.
  if (payload === undefined) return new HttpError(response.status);

  const error = readErrorEnvelope(payload);
  if (!error) {
    throw new MalformedApiResponse(
      `The API answered ${response.status} with a body that is not ` +
        `{ error: { code, message } }: ${JSON.stringify(payload)}`,
    );
  }
  return new ApiError(response.status, error.code, error.message, error.fields);
}

/** The parsed body, or undefined when the response deliberately has none. */
async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    // A success that promised JSON and sent something else is this API
    // breaking its contract, and the caller is about to read fields off it.
    if (response.ok) {
      throw new MalformedApiResponse(
        `The API answered ${response.status} with a body that is not JSON: ${text.slice(0, 200)}`,
      );
    }
    // On a failure, unparseable text is a gateway's own error page. The status
    // is the honest thing to pass on.
    return undefined;
  }
}
