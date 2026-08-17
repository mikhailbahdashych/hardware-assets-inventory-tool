export interface RadioCardProps<V extends string> {
  name: string;
  value: V;
  checked: boolean;
  onChange: (value: V) => void;
  title: string;
  description: string;
}
