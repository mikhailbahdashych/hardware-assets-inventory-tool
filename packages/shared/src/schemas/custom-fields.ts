import { z } from 'zod';
import { CUSTOM_FIELD_TYPES } from '../enums.js';

// A custom field's key is its identity: it is the JSON key on the wire, the
// CSV column header, and what stored values hang off. It is derived from the
// label once and never changes, so renaming a field is safe.

export const customFieldCreateInput = z.object({
  label: z.string().trim().min(1).max(60),
  type: z.enum(CUSTOM_FIELD_TYPES),
});
export type CustomFieldCreateInput = z.infer<typeof customFieldCreateInput>;

/** The type is fixed once values exist under it; only presentation may change. */
export const customFieldPatchInput = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
});
export type CustomFieldPatchInput = z.infer<typeof customFieldPatchInput>;

/** "Warranty provider" → "warranty_provider". Empty means the label was unusable. */
export function toFieldKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
}
