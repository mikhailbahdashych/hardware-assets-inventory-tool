/**
 * What `parsePriceToCents` answers: integer cents (null meaning "no price"),
 * or the reason the text could not be read as an amount. A union rather than
 * an interface — the two arms carry different fields on purpose, so a caller
 * cannot read `cents` without first checking `ok`.
 */
export type PriceParse = { ok: true; cents: number | null } | { ok: false; reason: string };
