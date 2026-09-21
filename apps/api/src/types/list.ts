/**
 * What every whole-list endpoint takes. There is no upper bound on how big an
 * adopting company is, so Assets, Employees and Members are all paged and
 * searched on the server — the browser filters nothing now.
 *
 * `q` is absent when nothing was typed, which means the list is unfiltered.
 */
export interface ListQuery {
  q?: string;
  limit: number;
  offset: number;
}
