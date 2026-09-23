export interface DropdownOption<V extends string> {
  value: V;
  label: string;
  /** A second line inside the list — never shown on the closed control. */
  description?: string;
}

/** The trigger's rect and the viewport it opens into — `panelPosition`'s input. */
export interface PanelAnchor {
  top: number;
  bottom: number;
  left: number;
  width: number;
  viewportHeight: number;
}

/** Where the panel sits, measured from the trigger when the list opens. */
export interface PanelPosition {
  /** Set when the panel opens downward: the distance from the viewport's top. */
  top?: number;
  /**
   * Set when it opens upward: the distance from the viewport's *bottom*, which
   * is what keeps the panel against the trigger whatever height its options
   * turn out to have — a top computed here could not know it.
   */
  bottom?: number;
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
  /** Both set by `Field` when it has an error to announce; see `FieldErrorAria`. */
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}
