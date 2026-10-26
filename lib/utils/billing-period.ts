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
