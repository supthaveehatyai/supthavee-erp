/**
 * อ่านไฟล์ Backup ทั้งรูปแบบปัจจุบันและไฟล์เก่าที่เก็บแถวไว้ใน `tables`
 */

export type BackupRow = Record<string, unknown>;

export type NormalizedBackup = {
  exportedAt: string | null;
  module: string | null;
  tables: string[];
  rowCounts: Record<string, number>;
  skippedTables: string[];
  data: Record<string, BackupRow[]>;
};

function isRowMap(value: unknown): value is Record<string, BackupRow[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every((item) => Array.isArray(item));
}

function skippedNames(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object" && "table" in item) {
        const table = (item as { table?: unknown }).table;
        return typeof table === "string" ? table : "";
      }
      return "";
    })
    .filter((table) => table.length > 0);
}

export function normalizeBackupPayload(raw: unknown): NormalizedBackup {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("โครงสร้างไฟล์ Backup ไม่ถูกต้อง");
  }

  const record = raw as Record<string, unknown>;
  const data = isRowMap(record.data)
    ? record.data
    : isRowMap(record.tables)
      ? record.tables
      : null;

  if (!data) {
    throw new Error("ไม่พบข้อมูลตารางในไฟล์ Backup");
  }

  const namedTables =
    Array.isArray(record.tables) &&
    record.tables.every((item) => typeof item === "string")
      ? (record.tables as string[])
      : Object.keys(data);

  const declared =
    record.rowCounts &&
    typeof record.rowCounts === "object" &&
    !Array.isArray(record.rowCounts)
      ? (record.rowCounts as Record<string, unknown>)
      : {};

  const rowCounts: Record<string, number> = {};
  const tables = [...new Set([...namedTables, ...Object.keys(data)])];
  for (const table of tables) {
    const rows = data[table];
    if (Array.isArray(rows)) {
      rowCounts[table] = rows.length;
      continue;
    }
    const fallback = Number(declared[table]);
    rowCounts[table] = Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
  }

  return {
    exportedAt: typeof record.exportedAt === "string" ? record.exportedAt : null,
    module: typeof record.module === "string" ? record.module : null,
    tables,
    rowCounts,
    skippedTables: skippedNames(record.skipped_tables),
    data,
  };
}

export function parseBackupText(text: string): NormalizedBackup {
  const cleaned = text.replace(/^\uFEFF/, "").trim();
  return normalizeBackupPayload(JSON.parse(cleaned));
}

export async function readBackupFileText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  if (name.endsWith(".gz")) {
    const stream = new Blob([buffer])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    return new Response(stream).text();
  }
  return new TextDecoder().decode(buffer);
}
