/**
 * Temporary draft document numbers (Late Numbering).
 * Official running numbers come from RPC `generate_document_no` only on issue.
 *
 * Uses local server time with zero-padded components:
 * `DRAFT-YYYYMMDDHHmmss` e.g. `DRAFT-20260731172545`
 */

export function generateDraftDocumentNo(): string {
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
