import { RESTORE_TABLE_ORDER, upsertConflictColumn } from "@/lib/backup/backup-modules";
import type { BackupRow } from "@/lib/backup/backup-file";

export const RESTORE_UPSERT_BATCH = 500;

export type UpsertOptions = {
  onConflict?: string;
  ignoreDuplicates?: boolean;
};

const FIXED_CONFLICT: Record<string, string> = {
  system_parameters: "param_key",
  app_roles: "role_code",
  mst_uom: "uom_id",
  mst_carriers: "carrier_id",
};

function columnPresent(row: BackupRow | undefined, column: string): boolean {
  if (!row || !Object.prototype.hasOwnProperty.call(row, column)) return false;
  const value = row[column];
  return value != null && value !== "";
}

export function orderTablesForRestore(tables: string[]): string[] {
  const rank = new Map<string, number>(
    RESTORE_TABLE_ORDER.map((table, index) => [table, index]),
  );
  return [...tables].sort((left, right) => {
    const leftRank = rank.has(left) ? (rank.get(left) as number) : 10000;
    const rightRank = rank.has(right) ? (rank.get(right) as number) : 10000;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return left.localeCompare(right);
  });
}

export function sortRowsForRestore(table: string, rows: BackupRow[]): BackupRow[] {
  if (table !== "mst_categories") return rows;
  return [...rows].sort((left, right) => {
    const leftRoot = left.parent_id == null ? 0 : 1;
    const rightRoot = right.parent_id == null ? 0 : 1;
    return leftRoot - rightRoot;
  });
}

export function resolveUpsertOptions(
  table: string,
  firstRow: BackupRow | undefined,
): UpsertOptions {
  if (table === "audit_logs") {
    return { onConflict: "id", ignoreDuplicates: true };
  }

  const fixed = FIXED_CONFLICT[table];
  if (fixed) return { onConflict: fixed };

  if (columnPresent(firstRow, "id")) {
    return { onConflict: "id" };
  }

  if (firstRow) {
    const detected = Object.keys(firstRow).find(
      (column) =>
        columnPresent(firstRow, column) &&
        (column === "mapping_id" || column.endsWith("_key")),
    );
    if (detected) return { onConflict: detected };
  }

  const fallback = upsertConflictColumn(table);
  if (columnPresent(firstRow, fallback)) return { onConflict: fallback };
  return {};
}
