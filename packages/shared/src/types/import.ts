// The CSV vocabulary's shape. Imports here stay relative: this package is
// consumed as raw TypeScript source, so a `@/` would resolve against the
// consumer's alias and break the web build.

/**
 * One canonical column: what the header says and whether a row needs it. The
 * template the API serves, the wizard's auto-matcher and the validator all read
 * the same list of these, so a downloaded template can never be one the app
 * rejects.
 */
export interface ImportColumn {
  header: string;
  required: boolean;
}

/**
 * One value a CSV cell may name: the slug the database stores and the label a
 * spreadsheet shows. Both are matched, in any casing, because a file this app
 * exported must import straight back.
 */
export interface VocabularyEntry<T extends string = string> {
  value: T;
  label: string;
}

/**
 * What `matchEnumValue` reads a cell against. Two shapes, because two kinds of
 * vocabulary exist in the product: the ones still closed in code carry a label
 * map keyed by slug, and the statuses — rows an admin edits — arrive as a list
 * the caller has just read from the database.
 */
export type EnumVocabulary<T extends string> = Record<T, string> | readonly VocabularyEntry<T>[];
