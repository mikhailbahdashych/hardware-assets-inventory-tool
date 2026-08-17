// A component imports its own type module directly, never this barrel — that is what keeps barrels from forming import cycles.
export type { RowProps, SectionProps } from './kitchenSink';
