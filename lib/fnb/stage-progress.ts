import type { FnbStageConfirmation } from "@/types/fnb";

const OPENING_SECTIONS = [1, 2, 3, 4, 5, 6, 7];
const CLOSING_SECTIONS = [1, 2, 3, 4];

export function sectionNumber(stage: "OPENING" | "CLOSING", sectionKey: string): number | null {
  if (stage === "OPENING") {
    if (sectionKey.startsWith("SEC_7")) return 7;
    const match = sectionKey.match(/^SEC_(\d+)/);
    const value = match ? Number(match[1]) : 0;
    return value >= 1 && value <= 7 ? value : null;
  }
  if (sectionKey.startsWith("SEC_2") || sectionKey.startsWith("CL_SPOT")) return 2;
  if (sectionKey.startsWith("SEC_1")) return 1;
  if (sectionKey.startsWith("SEC_3")) return 3;
  if (sectionKey.startsWith("SEC_4")) return 4;
  return null;
}

export function formatSectionList(numbers: number[]): string {
  const unique = [...new Set(numbers)].sort((left, right) => left - right);
  const parts: string[] = [];
  let index = 0;
  while (index < unique.length) {
    let end = index;
    while (end + 1 < unique.length && unique[end + 1] === unique[end] + 1) end += 1;
    parts.push(end > index ? `${unique[index]}–${unique[end]}` : String(unique[index]));
    index = end + 1;
  }
  return parts.join(", ");
}

export function progressSummary(stage: "OPENING" | "CLOSING", rows: FnbStageConfirmation[]): { done: number; total: number; badges: string[] } {
  const total = stage === "OPENING" ? OPENING_SECTIONS.length : CLOSING_SECTIONS.length;
  const byStaff = new Map<string, number[]>();
  const done = new Set<number>();
  for (const row of rows) {
    const number = sectionNumber(stage, row.sectionKey);
    if (!number) continue;
    done.add(number);
    const list = byStaff.get(row.confirmedByName) ?? [];
    list.push(number);
    byStaff.set(row.confirmedByName, list);
  }
  const badges = [...byStaff.entries()].map(([name, numbers]) => `👤 ${name}: หมวด ${formatSectionList(numbers)}`);
  return { done: done.size, total, badges };
}

export function bangkokHour(now = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", hourCycle: "h23" }).format(now));
}

export function addDays(iso: string, days: number): string {
  const date = new Date(`${iso.slice(0, 10)}T12:00:00+07:00`);
  date.setDate(date.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

export function shortThaiDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split("-");
  if (!year || !month || !day) return iso;
  return `${Number(day)}/${Number(month)}`;
}

export function bangkokClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return `${new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).format(date)} น.`;
}
