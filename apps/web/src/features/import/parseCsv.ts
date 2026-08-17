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

  const headers = result.meta.fields ?? [];
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
