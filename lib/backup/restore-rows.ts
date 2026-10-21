import { RESTORE_TABLE_ORDER, upsertConflictColumn } from "@/lib/backup/backup-modules";
import type { BackupRow } from "@/lib/backup/backup-file";

export type UpsertOptions = {
  onConflict?: string;
  ignoreDuplicates?: boolean;
};

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
  if (table === "vendor_product_mapping") {
    if (firstRow && firstRow.id != null && firstRow.id !== "") {
      return { onConflict: "id" };
    }
    if (firstRow && firstRow.mapping_id != null && firstRow.mapping_id !== "") {
      return { onConflict: "mapping_id" };
    }
    return {};
  }
  return { onConflict: upsertConflictColumn(table) };
}
