export interface PaginationProps {
  /** 1-based, because that is what the buttons say. */
  page: number;
  pageCount: number;
  onChange: (page: number) => void;
}
