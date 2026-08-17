// A module imports its own type module directly (`./types/searchParams`), never
// this barrel — that is what keeps the barrel from forming an import cycle.
export type { SetParamOptions } from './searchParams';
