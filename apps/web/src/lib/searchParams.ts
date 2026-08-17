import type { SetParamOptions } from './types/searchParams';

/**
 * Writes a filter into the query string, dropping it when it carries the
 * default — so an unfiltered list stays at a clean `/assets`, and only a
 * meaningful filter shows up in the URL people copy.
 */
export function setParam(
  params: URLSearchParams,
  key: string,
  value: string,
  { omitWhen = '' }: SetParamOptions = {},
): void {
  if (value === omitWhen) params.delete(key);
  else params.set(key, value);
}
