/** One tab in the strip: the value it selects and the word drawn on it. */
export interface TabOption<V extends string> {
  value: V;
  label: string;
}

export interface TabsProps<V extends string> {
  tabs: TabOption<V>[];
  value: V;
  onChange: (value: V) => void;
}
