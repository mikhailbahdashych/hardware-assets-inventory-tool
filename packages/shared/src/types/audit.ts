/**
 * The structured payload stored beside an audit action — name snapshots and
 * whatever else the sentence needs. Deliberately open: a renderer reads the
 * keys it knows and the store never has to migrate old rows.
 */
export type AuditParams = Record<string, unknown>;

/** The part of a stored audit event `renderAuditEvent` needs to make a sentence. */
export interface RenderableAuditEvent {
  action: string;
  params?: AuditParams;
}
