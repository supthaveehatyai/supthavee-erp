/**
 * Shared helpers for AR/AP outstanding summary (Server-side only).
 */

/** Today as YYYY-MM-DD (UTC calendar date for stable server comparison). */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Add calendar days to YYYY-MM-DD (UTC). */
export function addDaysIso(isoDate: string, days: number): string {
  const base = isoDate.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(base)) return base;
  const d = new Date(`${base}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return base;
  d.setUTCDate(d.getUTCDate() + Math.max(0, Math.trunc(days)));
  return d.toISOString().slice(0, 10);
}

/**
 * Due date = explicit due_date, else document_date + credit_days.
 */
export function resolveDueDate(
  documentDate: string,
  dueDate: string | null | undefined,
  creditDays: number | null | undefined,
): string {
  const explicit = dueDate?.trim() ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(explicit)) return explicit;

  const docDate = documentDate?.trim() ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(docDate)) return "";

  const days = Number(creditDays ?? 0);
  return addDaysIso(docDate, Number.isFinite(days) ? days : 0);
}

export function isOverdue(dueDate: string, today: string): boolean {
  if (!dueDate || !today) return false;
  return dueDate < today;
}
