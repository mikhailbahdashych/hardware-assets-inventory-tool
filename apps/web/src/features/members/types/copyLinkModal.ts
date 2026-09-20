export interface CopyLinkModalProps {
  title: string;
  subtitle: string;
  /** Names the field, e.g. "Invitation link" — the tests and screen readers read it. */
  label: string;
  url: string;
  /** Replaces the link-expiry sentence — a set password is shown here too, and it does not expire. */
  hint?: string;
  onClose: () => void;
}
