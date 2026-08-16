import { z } from 'zod';
import { ASSET_CATEGORIES, ASSET_STATUSES, CURRENCIES } from '../enums.js';
import { MAX_PRICE_CENTS } from '../money.js';
import { nullableDate, nullableText } from './common.js';

// Wire contract for assets. Money arrives as integer cents (the form converts
// with parsePriceToCents); dates are date-only strings. On a create, an absent
// optional field means NULL; on a patch, absent means "leave alone" and an
// explicit null means "clear it".

const name = z.string().trim().min(1).max(160);
const priceCents = z.number().int().min(0).max(MAX_PRICE_CENTS);

/** Blank means "let the server generate the next tag from the org prefix". */
const optionalTag = z
  .string()
  .trim()
  .max(60)
  .transform((value) => (value === '' ? undefined : value))
  .optional();

/** Values for custom_field_defs, keyed by definition key; null clears one. */
const customValues = z.record(z.string(), z.string().nullable()).optional();

export const assetCreateInput = z
  .object({
    name,
    category: z.enum(ASSET_CATEGORIES),
    status: z.enum(ASSET_STATUSES),
    assetTag: optionalTag,
    model: nullableText(120).default(null),
    serialNumber: nullableText(120).default(null),
    purchaseDate: nullableDate.default(null),
    purchasePriceCents: priceCents.nullable().default(null),
    currency: z.enum(CURRENCIES).nullable().default(null),
    supplier: nullableText(120).default(null),
    warrantyUntil: nullableDate.default(null),
    notes: nullableText(4000).default(null),
    customValues,
    // Creating an asset as Assigned opens its first ownership record in the
    // same transaction, so the status ⇔ active-assignment invariant holds.
    assignedToEmployeeId: z.string().min(1).nullable().default(null),
    checkoutDate: nullableDate.default(null),
  })
  .refine((input) => input.status !== 'assigned' || Boolean(input.assignedToEmployeeId), {
    message: 'Choose who this asset is assigned to.',
    path: ['assignedToEmployeeId'],
  });
export type AssetCreateInput = z.infer<typeof assetCreateInput>;

/**
 * Editing an asset never moves it in or out of `assigned` — that is what
 * assign and check-in are for — so there are no holder fields here. Other
 * status moves are allowed and checked against `canDirectlyTransition`.
 */
export const assetPatchInput = z.object({
  name: name.optional(),
  category: z.enum(ASSET_CATEGORIES).optional(),
  status: z.enum(ASSET_STATUSES).optional(),
  assetTag: z.string().trim().min(1).max(60).optional(),
  model: nullableText(120).optional(),
  serialNumber: nullableText(120).optional(),
  purchaseDate: nullableDate.optional(),
  purchasePriceCents: priceCents.nullable().optional(),
  currency: z.enum(CURRENCIES).nullable().optional(),
  supplier: nullableText(120).optional(),
  warrantyUntil: nullableDate.optional(),
  notes: nullableText(4000).optional(),
  customValues,
});
export type AssetPatchInput = z.infer<typeof assetPatchInput>;
