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
