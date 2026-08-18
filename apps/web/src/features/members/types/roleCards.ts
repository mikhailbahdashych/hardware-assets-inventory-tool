export interface RoleCardsProps {
  name: string;
  /** A role id — a row's slug, so no build can narrow it to a union. */
  value: string;
  onChange: (role: string) => void;
}
