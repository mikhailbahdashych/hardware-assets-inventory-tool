/**
 * The lists that remember a page size, one key each. A union rather than a
 * string, because two surfaces sharing a key by typo is a bug nobody reports —
 * they would simply resize each other.
 */
export type PageSizeSurface = 'assets' | 'employees' | 'members' | 'notifications' | 'activity';

/** What `usePageSize` hands back, shaped like `useState` because it is one. */
export type PageSizeState = [size: number, setSize: (size: number) => void];
