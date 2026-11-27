const BAR_OPEN_PRIORITY = ["SB", "MB", "CS", "BS", "PF", "X", "CJ", "WMK", "CW", "CMK", "MK", "LEM"];

export function barOpenItems<T extends { short_code: string; item_category?: string; has_open_shelf_rule?: boolean }>(items: T[]): T[] {
  const rank = new Map(BAR_OPEN_PRIORITY.map((code, index) => [code, index]));
  return items
    .filter((item) => item.item_category === "RAW_MATERIAL")
    .slice()
    .sort((left, right) => {
      const leftPinned = left.has_open_shelf_rule === true || rank.has(left.short_code);
      const rightPinned = right.has_open_shelf_rule === true || rank.has(right.short_code);
      if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
      const leftRank = rank.get(left.short_code) ?? 500;
      const rightRank = rank.get(right.short_code) ?? 500;
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.short_code.localeCompare(right.short_code);
    });
}

export function barItemLabel(item: { short_code: string; name_th: string; count_uom?: string }): string {
  return `${item.short_code} · ${item.name_th}${item.count_uom ? ` (${item.count_uom})` : ""}`;
}

export function prepBaseLabel(base: { base_code: string; base_name_th?: string; yield_qty_ml: number }): string {
  const ml = base.yield_qty_ml.toLocaleString("th-TH", { maximumFractionDigits: 0 });
  return `${base.base_code} · ${base.base_name_th || base.base_code} (เต็มสูตร ${ml} ml)`;
}

export function itemMatches(query: string, item: {
  short_code?: string | null;
  alias_codes?: string[] | null;
  aliases?: string[] | null;
  external_code?: string | null;
  name_th?: string | null;
}): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const aliases = [...(item.alias_codes ?? []), ...(item.aliases ?? [])];
  const haystack = [item.short_code, item.external_code, item.name_th, ...aliases]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export function isBackroomDue(schedule: string, weekdays: number[], workDate: string): boolean {
  if (schedule === "DAILY") return true;
  const [year, month, day] = workDate.split("-").map(Number);
  if (!year || !month || !day) return false;
  if (schedule === "EVERY_3_DAYS") {
    const start = Date.UTC(year, 0, 1);
    const current = Date.UTC(year, month - 1, day);
    const dayOfYear = Math.floor((current - start) / 86400000) + 1;
    return dayOfYear % 3 === 0;
  }
  const weekday = new Date(`${workDate}T12:00:00+07:00`).getDay();
  if (schedule === "WEEKLY_2X" || schedule === "WEEKLY_1X") {
    return weekdays.length > 0 ? weekdays.includes(weekday) : weekday === 0;
  }
  if (schedule === "MONTHLY_ONLY") return day === 1;
  return false;
}
