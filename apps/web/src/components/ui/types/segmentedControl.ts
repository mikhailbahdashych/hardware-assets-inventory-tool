export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  title?: string;
}

export interface SegmentedControlProps<V extends string> {
  options: SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  /** Stretch to fill the row (form control) rather than hug (toolbar). */
  grow?: boolean;
}
