export interface ToggleSwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Accessible name for the switch. */
  label: string;
  disabled?: boolean;
}
