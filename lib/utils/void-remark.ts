/**
 * Strip the RPC/audit prefix from a voided document remark.
 * DB stores `[VOIDED]: <reason>` in `documents.notes`.
 */
export function stripVoidedRemarkPrefix(
  raw: string | null | undefined,
): string {
  return String(raw ?? "")
    .replace(/^\s*\[VOIDED\]:\s*/i, "")
    .trim();
}
