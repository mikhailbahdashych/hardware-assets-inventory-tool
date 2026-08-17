/** A file read in the browser, or the reason it could not be. */
export type ParsedCsv =
  | { ok: true; headers: string[]; rows: Record<string, string>[]; filename: string }
  | { ok: false; reason: string };

/**
 * The wizard's five steps. `mapping` is the one the design promises and the
 * prototype never drew past a button label.
 */
export type ImportStep = 'file' | 'mapping' | 'report' | 'done';

/** Canonical column header → the file header a person pointed it at. */
export type ColumnMapping = Record<string, string>;
