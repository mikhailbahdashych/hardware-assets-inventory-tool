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
