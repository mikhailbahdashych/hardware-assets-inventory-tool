export interface MenuItem {
  label: string;
  onSelect: () => void;
  /** Rendered in --err: removing a member, deleting a record. */
  danger?: boolean;
}

/** Where the panel sits, measured from the trigger when the menu opens. */
export interface MenuAnchor {
  top: number;
  right: number;
  maxHeight: number;
}

export interface MenuProps {
  label: string;
  items: MenuItem[];
  /**
   * Focus the trigger as it mounts — for a page handing focus back to a row
   * whose trigger was replaced (an armed confirm) or whose neighbour just left.
   */
  autoFocus?: boolean;
}
