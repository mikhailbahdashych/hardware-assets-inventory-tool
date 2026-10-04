import type { ReactNode } from 'react';

/** One column of a `DataTable`, declared by the page that renders the list. */
export interface TableColumn<T> {
  header: ReactNode;
  /** One grid-template-columns track, e.g. "minmax(210px,1.6fr)" or "95px". */
  width: string;
  render: (row: T) => ReactNode;
  align?: 'left' | 'right';
  /**
   * `'end'` pins the column to the table's right edge while the rest scrolls
   * under it. For a row's actions: when a narrow screen scrolls the table, the
   * menu that is the only way to act on a row stays in view beside its row.
   */
  sticky?: 'end';
}
