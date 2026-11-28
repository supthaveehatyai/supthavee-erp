const DISCRETE_UNITS = new Set([
  "กระป๋อง",
  "ขวด",
  "กล่อง",
  "ถุง",
  "ชิ้น",
  "ใบ",
  "แท่ง",
  "เล่ม",
  "โคน",
  "ลูก",
  "แพ็ค",
  "ลัง",
  "ห่อ",
  "แถว",
  "ml",
]);

export function formatFnbQty(qty: number | string | null | undefined, uom?: string, allowDecimal?: boolean): string {
  const amount = Number(qty ?? 0);
  const safe = Number.isFinite(amount) ? amount : 0;
  const unit = (uom || "").trim();
  const discrete = DISCRETE_UNITS.has(unit) || allowDecimal === false || Number.isInteger(safe);
  const shown = discrete
    ? Math.round(safe).toLocaleString("en-US")
    : String(Number(safe.toFixed(2)));
  return unit ? `${shown} ${unit}` : shown;
}

export function produceProfile(item: {
  is_catch_weight_produce?: boolean | null;
  piece_uom_label?: string | null;
  avg_gross_grams_per_piece?: number | null;
  prep_yield_pct?: number | null;
} | null | undefined) {
  const label = (item?.piece_uom_label || "").trim() || "ลูก";
  const avg = Number(item?.avg_gross_grams_per_piece) > 0 ? Number(item?.avg_gross_grams_per_piece) : 110;
  const yieldPct = Number(item?.prep_yield_pct) > 0 ? Number(item?.prep_yield_pct) : 80;
  return {
    enabled: item?.is_catch_weight_produce === true,
    label,
    avg,
    yieldPct,
    usablePerPiece: Math.round((avg * yieldPct) / 100),
  };
}

function bangkokParts(input: string | Date): { year: number; month: number; day: number; hour: number; minute: number } | null {
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const year = pick("year");
  const month = pick("month");
  const day = pick("day");
  if (!year || !month || !day) return null;
  return { year, month, day, hour: pick("hour") || 0, minute: pick("minute") || 0 };
}

export function formatShortDateTH(input: string | Date | null | undefined): string {
  if (input == null || input === "") return "—";
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) {
    const [year, month, day] = input.trim().split("-").map(Number);
    const yy = String((year + 543) % 100).padStart(2, "0");
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${yy}`;
  }
  const parts = bangkokParts(input);
  if (!parts) return "—";
  const yy = String((parts.year + 543) % 100).padStart(2, "0");
  return `${String(parts.day).padStart(2, "0")}/${String(parts.month).padStart(2, "0")}/${yy}`;
}

export function formatTimeHHMM(input: string | Date | null | undefined): string {
  if (input == null || input === "") return "—";
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input.trim())) return "—";
  const parts = bangkokParts(input);
  if (!parts) return "—";
  return `${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

export function formatPrepPortionPct(packsDeducted: number, brewPortionMode?: string): string {
  const mode = (brewPortionMode || "").trim().toUpperCase();
  if (mode === "PCT_25") return "25%";
  if (mode === "PCT_50") return "50%";
  if (mode === "PCT_75") return "75%";
  const packs = Number(packsDeducted);
  if (Number.isFinite(packs) && packs > 0 && packs < 1) return `${Math.round(packs * 100)}%`;
  if (mode === "FULL_RECIPE" || mode === "1" || packs === 1) return "100%";
  if (Number.isFinite(packs) && packs > 1 && packs <= 100 && Number.isInteger(packs)) return `${Math.round(packs)}%`;
  if (Number.isFinite(packs) && packs > 0) return `${Math.round(packs * 100)}%`;
  return "100%";
}
