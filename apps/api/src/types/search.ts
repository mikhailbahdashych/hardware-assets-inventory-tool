// What the command palette asks for: a few assets and a few people for one
// needle. Deliberately narrow shapes rather than the list payloads — a palette
// row draws four fields, and everything else is somebody's serial number.

/** An asset as one palette row: title, tag, its status pill and its category. */
export interface AssetHit {
  id: string;
  name: string;
  assetTag: string;
  /** A status id, so the palette can draw the workspace's own label and colour. */
  status: string;
  category: string;
}

/** A person as one palette row. No email: the row does not draw one. */
export interface EmployeeHit {
  id: string;
  displayName: string;
  jobTitle: string | null;
  department: string | null;
}

export interface SearchPayload {
  assets: AssetHit[];
  employees: EmployeeHit[];
}
