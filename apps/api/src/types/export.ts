import type {
  assetCustomValues,
  assets,
  assignments,
  customFieldDefs,
  employees,
} from '@/db/schema.js';
import type { OrgSettingsRow } from '@/services/settings.js';

// The export-all payload. Row types come straight from the tables, so adding a
// column to the schema adds it to the export with no second list to maintain —
// except where a table is narrowed on purpose (members, attachments), which is
// exactly where the omissions need to be spelled out.

/** A member as the export lists them: no password hash, ever. */
export interface ExportedMember {
  id: string;
  email: string;
  displayName: string;
  role: string;
  status: string;
  employeeId: string | null;
  lastActiveAt: string | null;
  createdAt: string;
}

/** An attachment's record without its bytes — those live in DATA_DIR/uploads. */
export interface ExportedAttachment {
  id: string;
  assetId: string;
  filename: string;
  sizeBytes: number;
  mime: string | null;
  uploadedByMemberId: string | null;
  createdAt: string;
}

export interface ExportedAuditEvent {
  id: string;
  at: string;
  type: string;
  action: string;
  actorMemberId: string | null;
  actorName: string;
  assetId: string | null;
  employeeId: string | null;
  memberId: string | null;
  /** Still the stored JSON string: the renderer is what turns it into a sentence. */
  params: string;
}

export interface WorkspaceExport {
  formatVersion: number;
  exportedAt: string;
  settings: OrgSettingsRow;
  members: ExportedMember[];
  employees: (typeof employees.$inferSelect)[];
  assets: (typeof assets.$inferSelect)[];
  assignments: (typeof assignments.$inferSelect)[];
  customFieldDefs: (typeof customFieldDefs.$inferSelect)[];
  assetCustomValues: (typeof assetCustomValues.$inferSelect)[];
  attachments: ExportedAttachment[];
  auditEvents: ExportedAuditEvent[];
}
