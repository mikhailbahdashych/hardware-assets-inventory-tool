import type { FieldRow } from './spec';

export interface FieldsTableProps {
  /** The table's accessible name and its visible label: "Parameters", "Request body". */
  label: string;
  rows: FieldRow[];
}
