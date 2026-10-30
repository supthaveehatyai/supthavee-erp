export type SortDir = "asc" | "desc";

export type ContactSortKey = "amount" | "name" | "count";

export type NoteSortKey = "doc_no" | "name" | "amount" | "doc_date" | "due_date";

export type BillingStatusFilter = "all" | "pending" | "paid";

export const NOTE_SORT_OPTIONS: { key: NoteSortKey; dir: SortDir; label: string }[] = [
  { key: "doc_no", dir: "asc", label: "เลขที่ใบวางบิล (0001 → 0008)" },
  { key: "doc_no", dir: "desc", label: "เลขที่ใบวางบิล (0008 → 0001)" },
  { key: "name", dir: "asc", label: "ชื่อคู่ค้า (ก → ฮ)" },
  { key: "name", dir: "desc", label: "ชื่อคู่ค้า (ฮ → ก)" },
  { key: "amount", dir: "desc", label: "ยอดรวม (มาก → น้อย)" },
  { key: "amount", dir: "asc", label: "ยอดรวม (น้อย → มาก)" },
  { key: "doc_date", dir: "asc", label: "วันที่เอกสาร (เก่า → ใหม่)" },
  { key: "doc_date", dir: "desc", label: "วันที่เอกสาร (ใหม่ → เก่า)" },
  { key: "due_date", dir: "asc", label: "วันครบกำหนด (เก่า → ใหม่)" },
  { key: "due_date", dir: "desc", label: "วันครบกำหนด (ใหม่ → เก่า)" },
];

const NOTE_DEFAULT_DIR: Record<NoteSortKey, SortDir> = {
  doc_no: "asc",
  name: "asc",
  amount: "desc",
  doc_date: "asc",
  due_date: "asc",
};

const CONTACT_DEFAULT_DIR: Record<ContactSortKey, SortDir> = {
  amount: "desc",
  name: "asc",
  count: "desc",
};

export function toggleSortDir(dir: SortDir): SortDir {
  return dir === "asc" ? "desc" : "asc";
}

export function nextNoteSort(
  currentKey: NoteSortKey,
  currentDir: SortDir,
  nextKey: NoteSortKey,
): { key: NoteSortKey; dir: SortDir } {
  if (currentKey === nextKey) return { key: nextKey, dir: toggleSortDir(currentDir) };
  return { key: nextKey, dir: NOTE_DEFAULT_DIR[nextKey] };
}

export function nextContactSort(
  currentKey: ContactSortKey,
  currentDir: SortDir,
  nextKey: ContactSortKey,
): { key: ContactSortKey; dir: SortDir } {
  if (currentKey === nextKey) return { key: nextKey, dir: toggleSortDir(currentDir) };
  return { key: nextKey, dir: CONTACT_DEFAULT_DIR[nextKey] };
}

export function sortArrow(active: boolean, dir: SortDir): "↑" | "↓" | "↕" {
  if (!active) return "↕";
  return dir === "asc" ? "↑" : "↓";
}

export function isPaidBillingStatus(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return normalized === "PAID" || normalized === "COMPLETED";
}

export function matchesBillingStatus(status: string, filter: BillingStatusFilter): boolean {
  if (filter === "all") return true;
  const paid = isPaidBillingStatus(status);
  if (filter === "paid") return paid;
  const normalized = status.trim().toUpperCase();
  return normalized === "PENDING" || normalized === "UNPAID" || normalized === "PARTIAL";
}

export function matchesContactQuery(name: string, query: string): boolean {
  const q = query.trim().toLocaleLowerCase("th");
  if (!q) return true;
  return name.toLocaleLowerCase("th").includes(q);
}

export function compareThaiName(a: string, b: string): number {
  return a.localeCompare(b, "th", { sensitivity: "base" });
}

export function compareDocNo(a: string, b: string): number {
  return a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
}

export function sortContacts<T>(
  rows: readonly T[],
  key: ContactSortKey,
  dir: SortDir,
  read: {
    name: (row: T) => string;
    count: (row: T) => number;
    amount: (row: T) => number;
  },
): T[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let diff = 0;
    if (key === "name") diff = compareThaiName(read.name(a), read.name(b));
    else if (key === "count") diff = read.count(a) - read.count(b);
    else diff = read.amount(a) - read.amount(b);
    if (diff === 0) diff = compareThaiName(read.name(a), read.name(b));
    return diff * factor;
  });
}

export type NoteSortRow = {
  doc_no: string;
  contact_name: string;
  grand_total: number;
  doc_date: string;
  due_date: string | null;
};

export function sortBillingNotes<T extends NoteSortRow>(
  rows: readonly T[],
  key: NoteSortKey,
  dir: SortDir,
): T[] {
  const factor = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    let diff = 0;
    if (key === "doc_no") diff = compareDocNo(a.doc_no, b.doc_no);
    else if (key === "name") diff = compareThaiName(a.contact_name, b.contact_name);
    else if (key === "amount") diff = a.grand_total - b.grand_total;
    else if (key === "doc_date") diff = a.doc_date.localeCompare(b.doc_date);
    else diff = (a.due_date ?? "").localeCompare(b.due_date ?? "");
    if (diff === 0) diff = compareDocNo(a.doc_no, b.doc_no);
    return diff * factor;
  });
}
