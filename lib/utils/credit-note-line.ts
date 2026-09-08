/**
 * Persist Credit Note line metadata in `document_items.description`
 * without adding a schema column (schema lock: database-schema.md).
 *
 * Format (prefix, never truncated): `[#CN src=<uuid> ret=0|1] <description>`
 * `ret=1` = Return to Inventory เมื่อ ISSUE
 */

const CN_LINE_META_RE =
  /^\[#CN src=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}) ret=([01])\]\s*/i;

export type CreditNoteLineMeta = {
  sourceItemId: string;
  returnToInventory: boolean;
  description: string;
};

export function parseCreditNoteLineMeta(
  raw: string | null | undefined,
): CreditNoteLineMeta | null {
  const text = String(raw ?? "");
  const match = CN_LINE_META_RE.exec(text);
  if (!match) return null;
  return {
    sourceItemId: match[1].toLowerCase(),
    returnToInventory: match[2] === "1",
    description: text.slice(match[0].length).trim(),
  };
}

export function stripCreditNoteLineMeta(
  raw: string | null | undefined,
): string {
  const parsed = parseCreditNoteLineMeta(raw);
  if (parsed) return parsed.description;
  return String(raw ?? "").trim();
}

export function encodeCreditNoteLineDescription(params: {
  sourceItemId: string;
  returnToInventory: boolean;
  description: string;
}): string {
  const src = params.sourceItemId.trim().toLowerCase();
  const ret = params.returnToInventory ? "1" : "0";
  const desc = stripCreditNoteLineMeta(params.description);
  return `[#CN src=${src} ret=${ret}] ${desc}`.slice(0, 255);
}

/** qty compare — NUMERIC(14,4) friendly, no Math.round / parseInt */
export function qtyExceedsLimit(value: number, limit: number): boolean {
  return value - limit > 0.00005;
}

export function remainingQty(sourceQty: number, creditedQty: number): number {
  const left = sourceQty - creditedQty;
  if (!Number.isFinite(left) || left <= 0.00005) return 0;
  return left;
}
