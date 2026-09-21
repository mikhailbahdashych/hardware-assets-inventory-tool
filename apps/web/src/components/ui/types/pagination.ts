/**
 * The rows-per-page selector, passed as one object rather than three loose
 * props: a size with nowhere to send a change is a dead control, and a shape
 * cannot be passed half.
 */
export interface RowsPerPageProps {
  size: number;
  /** Defaults to `PAGE_SIZES`; every one of them is inside the API's ceiling. */
  options?: readonly number[];
  onChange: (size: number) => void;
}

/** Prev · numbered pages · Next, the half that only a longer list needs. */
export interface PagerProps {
  /** 1-based, because that is what the buttons say. */
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}

export interface PaginationProps extends PagerProps {
  /** Left out, the pager is only a pager — which is how it started. */
  rowsPerPage?: RowsPerPageProps;
}
