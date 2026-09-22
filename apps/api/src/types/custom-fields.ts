/**
 * One custom-field definition as the API sends it — the row minus `createdAt`,
 * which no reader draws. Named here rather than beside the query because two
 * surfaces answer with it now: the internal route and its public twin.
 */
export interface CustomFieldSummary {
  id: string;
  key: string;
  label: string;
  type: string;
  sortOrder: number;
}
