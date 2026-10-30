import { formatThaiDate } from "@/lib/utils/date-formatter";

export function addIsoDays(isoDate: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate.trim());
  if (!match) return isoDate.slice(0, 10);
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + Math.trunc(days));
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthKeyFromIso(isoDate: string): string {
  return isoDate.trim().slice(0, 7);
}

export function monthBounds(monthKey: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const last = new Date(year, month, 0).getDate();
  return {
    from: `${match[1]}-${match[2]}-01`,
    to: `${match[1]}-${match[2]}-${String(last).padStart(2, "0")}`,
  };
}

/** `ส.ค. 2569` from a `YYYY-MM` key. */
export function thaiMonthLabel(monthKey: string): string {
  const bounds = monthBounds(monthKey);
  if (!bounds) return monthKey;
  const labeled = formatThaiDate(bounds.from, "long");
  const parts = labeled.split(" ");
  return parts.length >= 3 ? `${parts[1]} ${parts[2]}` : labeled;
}

/** Last calendar day of the month that contains `YYYY-MM-DD`. */
export function endOfMonthIso(isoDate: string): string {
  const bounds = monthBounds(monthKeyFromIso(isoDate));
  return bounds?.to ?? isoDate.trim().slice(0, 10);
}

/**
 * Due date must not sit before the billing-note date.
 * Prefer credit days; otherwise the last day of the billing month.
 */
export function coerceBillingDueDate(
  billingDate: string,
  dueDate: string,
  creditDays: number,
): string {
  const billing = billingDate.trim().slice(0, 10);
  const due = dueDate.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(billing)) return due;
  if (/^\d{4}-\d{2}-\d{2}$/.test(due) && due >= billing) return due;
  const days = Math.max(0, Math.trunc(Number(creditDays) || 0));
  if (days > 0) return addIsoDays(billing, days);
  return endOfMonthIso(billing);
}

export function invoiceInRange(
  docDate: string,
  from: string,
  to: string,
): boolean {
  const day = docDate.trim().slice(0, 10);
  if (from && day < from) return false;
  if (to && day > to) return false;
  return true;
}
