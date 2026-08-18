/**
 * "On loan!" → "on_loan". The one derivation behind `statusSlug` and
 * `roleSlug`, and the same shape as a custom field's key — it is what asset
 * rows, member rows, CSV cells and URLs carry, so it may only contain
 * characters all of them can hold.
 *
 * An empty result means the label was unusable; the caller turns that into a
 * 422 naming the label, because only the caller knows what it was naming.
 *
 * Deliberately not exported from the package index: `slugify` is too generic a
 * name for a public surface, the same reasoning as the field builders in
 * `schemas/common.ts`. The two named exports are what callers reach for.
 */
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}
