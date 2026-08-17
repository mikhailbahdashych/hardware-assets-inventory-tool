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
  constructor(status: number) {
    super(status, `http_${status}`, `The request failed with HTTP ${status}.`);
    this.name = 'HttpError';
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

export async function apiFetch<T = unknown>(path: string, options: ApiRequest = {}): Promise<T> {
  const { method = 'GET', body, signal } = options;

  const response = await fetch(`${API_BASE}${path}`, {
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
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'same-origin',
    body,
  });
  const payload = await readJson(response);
  if (!response.ok) throw toApiError(response, payload);
  return payload as T;
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
