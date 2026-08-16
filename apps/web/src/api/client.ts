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

export type ApiRequest = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  signal?: AbortSignal;
};

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

function toApiError(response: Response, payload: unknown): ApiError {
  const envelope = (
    payload as { error?: { code?: string; message?: string; fields?: Record<string, string> } }
  )?.error;
  return new ApiError(
    response.status,
    envelope?.code ?? 'request_failed',
    envelope?.message ?? 'The server could not complete that request.',
    envelope?.fields,
  );
}

async function readJson(response: Response): Promise<unknown> {
  if (response.status === 204) return undefined;
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
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
