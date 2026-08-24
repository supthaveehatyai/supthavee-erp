/**
 * Thai Buddhist Era date formatter (พ.ศ. เสมอ).
 * Always use this helper — never format dates inline in UI.
 */

export type ThaiDateFormatType = "short" | "long" | "monthYear";

function parseToDate(date: string | Date): Date | null {
  if (date instanceof Date) {
    return Number.isNaN(date.getTime()) ? null : date;
  }

  const raw = String(date ?? "").trim();
  if (!raw) return null;

  const iso = raw.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match) {
    const parsed = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function createThaiFormatter(
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("th-TH", {
    calendar: "buddhist",
    numberingSystem: "latn",
    ...options,
  });
}

function readPart(
  parts: Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/**
 * จัดรูปแบบวันที่เป็น พ.ศ. เสมอผ่าน Intl.DateTimeFormat('th-TH')
 *
 * - short → DD/MM/YYYY เช่น 31/08/2569
 * - long → DD MMM YYYY เช่น 31 ส.ค. 2569
 * - monthYear → MMMM YYYY เช่น สิงหาคม 2569 (งวดบัญชี)
 */
export function formatThaiDate(
  date: string | Date,
  formatType: ThaiDateFormatType = "short",
): string {
  const parsed = parseToDate(date);
  if (!parsed) return "—";

  if (formatType === "monthYear") {
    const parts = createThaiFormatter({
      month: "long",
      year: "numeric",
    }).formatToParts(parsed);
    const month = readPart(parts, "month");
    const year = readPart(parts, "year");
    if (!month || !year) return "—";
    return `${month} ${year}`;
  }

  if (formatType === "long") {
    const parts = createThaiFormatter({
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).formatToParts(parsed);
    const day = readPart(parts, "day").padStart(2, "0");
    const month = readPart(parts, "month");
    const year = readPart(parts, "year");
    if (!day || !month || !year) return "—";
    return `${day} ${month} ${year}`;
  }

  const parts = createThaiFormatter({
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(parsed);
  const day = readPart(parts, "day").padStart(2, "0");
  const month = readPart(parts, "month").padStart(2, "0");
  const year = readPart(parts, "year");
  if (!day || !month || !year) return "—";
  return `${day}/${month}/${year}`;
}
