/**
 * Theme and density ride on `<html data-theme data-density>` and are also
 * stored per member on the server, so both the provider and the wire shapes in
 * `@/types/api` need them — they live here rather than inside either one.
 */
export type Theme = 'light' | 'dark';

export type Density = 'comfortable' | 'compact';
