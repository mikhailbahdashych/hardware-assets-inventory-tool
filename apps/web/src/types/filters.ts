/**
 * The status pill row offers every status the workspace has, plus "All".
 * A status id is text, not a union: the values are rows an admin edits on the
 * Workflow page, so no build knows the set. `parseStatusFilter` is what checks
 * a URL against the workspace's own list.
 */
export type StatusFilter = string;
