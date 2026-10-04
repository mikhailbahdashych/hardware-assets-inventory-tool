/** What `usePage` hands back: the page, its setter, and the clamp. */
export interface PageState {
  page: number;
  setPage: (page: number) => void;
  /**
   * Called during render once a list has arrived: pulls the page back to the
   * last one `total` still fills, and returns how many pages there are.
   */
  clampTo: (total: number, size: number) => number;
}
