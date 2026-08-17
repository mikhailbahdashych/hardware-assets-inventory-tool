export interface CopyLinkModalProps {
  title: string;
  subtitle: string;
  /** Names the field, e.g. "Invitation link" — the tests and screen readers read it. */
  label: string;
  url: string;
  onClose: () => void;
}
