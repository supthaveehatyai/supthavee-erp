/**
 * Strip the RPC/audit prefix from a voided document remark.
 * Prefer `documents.remark`; older rows may still store `[VOIDED]:` in `notes`.
 */
export function stripVoidedRemarkPrefix(
  raw: string | null | undefined,
): string {
  return String(raw ?? "")
    .replace(/^\s*\[VOIDED\]:\s*/i, "")
    .trim();
}

/** Prefer `remark`, then `void_reason`, then `notes`. */
export function resolveVoidRemark(
  remark?: string | null,
  voidReason?: string | null,
  notes?: string | null,
): string {
  return (
    stripVoidedRemarkPrefix(remark) ||
    stripVoidedRemarkPrefix(voidReason) ||
    stripVoidedRemarkPrefix(notes)
  );
}
