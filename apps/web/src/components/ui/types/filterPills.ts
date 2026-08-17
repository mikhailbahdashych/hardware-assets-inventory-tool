export interface FilterPillOption<V extends string> {
  value: V;
  label: string;
  count?: number;
}

export interface FilterPillsProps<V extends string> {
  options: FilterPillOption<V>[];
  value: V;
  onChange: (value: V) => void;
}
