import Papa from 'papaparse';
import type { ParsedCsv } from '@/types/import';

/** The design's ceiling, and a size guard so a stray file cannot hang a tab. */
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/**
 * Reads the file in the browser: the server never sees CSV, only the canonical
 * rows the mapping step produces. Parsing is papaparse's job — quoted commas,
 * embedded newlines, CRLF and a UTF-8 BOM are exactly the cases a hand-rolled
 * splitter gets wrong on somebody else's export.
 */
export async function parseCsv(file: File): Promise<ParsedCsv> {
  if (file.size > MAX_IMPORT_BYTES) {
    return { ok: false, reason: 'That file is larger than 2 MB.' };
  }

  const result = await new Promise<Papa.ParseResult<Record<string, string>>>((resolve) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: resolve,
    });
  });

  // `header: true` is what makes papaparse fill `fields`, so an absent list is
  // a header it could not produce — reported, not read as a file with none.
  const headers = result.meta.fields;
  if (headers === undefined) {
    return { ok: false, reason: 'The header row of that file could not be read.' };
  }
  // A quote nobody closed runs everything after it into one cell. In the header
  // row that is the whole file read as a single column name, which would
  // otherwise surface as "no data rows" — a diagnosis of the wrong thing.
  const unclosed = result.errors.find((error) => error.type === 'Quotes');
  if (unclosed) {
    // papaparse sets `row` at both places it raises a Quotes error: the index
    // of the record it was reading, the header being record 0 and blank lines
    // counted. It reads a local file in 10 MB chunks and MAX_IMPORT_BYTES is
    // 2 MB, so that index is the file's own — and the spreadsheet's "Row N",
    // with the header as row 1, is the index plus one.
    const row = unclosed.row!;
    return {
      ok: false,
      reason:
        row === 0
          ? 'The header row of that file opens a quote it never closes, so its columns cannot be read.'
          : `Row ${row + 1} of that file opens a quote it never closes, so everything after it runs into one cell.`,
    };
  }
  if (headers.length === 0) {
    return { ok: false, reason: 'That file has no header row.' };
  }
  if (result.data.length === 0) {
    return { ok: false, reason: 'That file has no data rows.' };
  }
  if (result.data.length > MAX_IMPORT_ROWS) {
    return {
      ok: false,
      reason: `That file has ${result.data.length} rows; the limit is ${MAX_IMPORT_ROWS}.`,
    };
  }

  return { ok: true, headers, rows: result.data, filename: file.name };
}
