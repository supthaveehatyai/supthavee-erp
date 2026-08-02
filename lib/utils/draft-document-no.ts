/**
 * Temporary draft document numbers (Late Numbering).
 * Official running numbers come from RPC only on ISSUE.
 *
 * CRITICAL: Always use CURRENT system date/time (`new Date()` at click/save).
 * NEVER derive the prefix from user-input `expense_date` / receipt date —
 * that field is business data only and must not affect Draft IDs.
 *
 * Format: `DRAFT-YYYYMMDDHHmmss` e.g. `DRAFT-20260802080015`
 */

export function generateDraftDocumentNo(_ignored?: unknown): string {
  // Parameter intentionally unused — blocks accidental callers from passing
  // expense_date / receipt date into the Draft ID generator.
  void _ignored;

  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  const hours = String(now.getHours()).padStart(2, "0");
  const minutes = String(now.getMinutes()).padStart(2, "0");
  const seconds = String(now.getSeconds()).padStart(2, "0");

  return `DRAFT-${year}${month}${day}${hours}${minutes}${seconds}`;
}

export function isTemporaryDraftDocNo(
  docNo: string | null | undefined,
): boolean {
  return String(docNo ?? "").startsWith("DRAFT-");
}
