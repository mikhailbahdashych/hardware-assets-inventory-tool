/** A file read in the browser, or the reason it could not be. */
export type ParsedCsv =
  | { ok: true; headers: string[]; rows: Record<string, string>[]; filename: string }
  | { ok: false; reason: string };

/**
 * The wizard's five steps. `mapping` is the one that does the real work: it
 * turns a spreadsheet into canonical rows, so the API never learns what a
 * particular file called its columns.
 */
export type ImportStep = 'file' | 'mapping' | 'report' | 'done';

/** Canonical column header → the file header a person pointed it at. */
export type ColumnMapping = Record<string, string>;
