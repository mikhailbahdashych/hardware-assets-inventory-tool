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
}
