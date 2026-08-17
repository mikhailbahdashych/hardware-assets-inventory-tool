export interface DropdownOption<V extends string> {
  value: V;
  label: string;
  /** A second line inside the list — never shown on the closed control. */
  description?: string;
}

/** Where the panel sits, measured from the trigger when the list opens. */
export interface PanelPosition {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

export interface DropdownProps<V extends string> {
  value: V;
  options: readonly DropdownOption<V>[];
  onChange: (value: V) => void;
  /** From `Field`'s render prop; a <button> is labelable, so its label names this. */
  id?: string;
  disabled?: boolean;
  'aria-label'?: string;
}
