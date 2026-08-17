import type { orgSettings } from '@/db/schema.js';

/**
 * The one org-settings row, as `/setup` writes it and the Settings page edits
 * it. There is never a second one, and never none: `getSettings` throws rather
 * than inventing defaults nobody chose.
 */
export type OrgSettingsRow = typeof orgSettings.$inferSelect;
