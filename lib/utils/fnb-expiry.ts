export type ShelfLifeUnit = "DAYS" | "MONTHS" | "YEARS";
export type DateStampMode = "MFD" | "EXP";

const NO_OPEN_WEIGHT = new Set(["PACKAGING", "MERCHANDISE", "BAKERY_FROZEN", "CONE"]);

export function shelfLifeUnit(value: string | null | undefined): ShelfLifeUnit {
  const unit = (value || "").trim().toUpperCase();
  if (unit === "DAY" || unit === "DAYS" || unit === "วัน") return "DAYS";
  if (unit === "YEAR" || unit === "YEARS" || unit === "ปี") return "YEARS";
  return "MONTHS";
}

export function dateStampMode(value: string | null | undefined): DateStampMode {
  return (value || "").trim().toUpperCase() === "EXP" ? "EXP" : "MFD";
}

export function shelfLifeLabel(value: number, unit: string | null | undefined): string {
  const amount = Math.max(0, Math.trunc(Number(value) || 0));
  const normalized = shelfLifeUnit(unit);
  if (normalized === "DAYS") return `${amount} วัน`;
  if (normalized === "YEARS") return `${amount} ปี`;
  return `${amount} เดือน`;
}

export function parseChinese8DigitDate(raw: string): string | null {
  const compact = raw.trim().replace(/[./]/g, "-");
  const eight = compact.match(/^(\d{4})(\d{2})(\d{2})$/);
  const dashed = compact.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const hit = eight || dashed;
  if (!hit) return null;
  const year = Number(hit[1]);
  const month = Number(hit[2]);
  const day = Number(hit[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  return `${hit[1]}-${hit[2]}-${hit[3]}`;
}

function isoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function calcExpiryDateFromMfg(mfgDateStr: string, value: number, unit: ShelfLifeUnit): string | null {
  const parsed = parseChinese8DigitDate(mfgDateStr);
  const amount = Math.trunc(Number(value) || 0);
  if (!parsed || amount <= 0) return null;
  const [yearText, monthText, dayText] = parsed.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (unit === "DAYS") {
    const next = new Date(Date.UTC(year, month - 1, day + amount));
    return isoDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
  }
  const months = unit === "YEARS" ? amount * 12 : amount;
  const cursor = month - 1 + months;
  const nextYear = year + Math.floor(cursor / 12);
  const nextMonth = (cursor % 12) + 1;
  const lastDay = new Date(Date.UTC(nextYear, nextMonth, 0)).getUTCDate();
  return isoDate(nextYear, nextMonth, Math.min(day, lastDay));
}

export function bangkokTodayIso(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(now);
}

export function daysUntilDate(iso: string | null | undefined, today = bangkokTodayIso()): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const target = Date.parse(`${iso}T00:00:00Z`);
  const start = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(target) || !Number.isFinite(start)) return null;
  return Math.round((target - start) / 86400000);
}

export function formatThaiDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  if (!year || !month || !day) return iso;
  return `${day}/${month}/${year}`;
}

export function openPackNetQty(grossGrams: number, tareGrams: number, specificGravity: number, recipeUom: string): number {
  const netGrams = Math.max(Number(grossGrams) - Number(tareGrams || 0), 0);
  if ((recipeUom || "").toLowerCase() === "ml") return Math.round((netGrams / Math.max(Number(specificGravity) || 1, 0.1)) * 100) / 100;
  return Math.round(netGrams * 100) / 100;
}

export function hidesOpenPackWeight(category: string): boolean {
  return NO_OPEN_WEIGHT.has(category);
}
