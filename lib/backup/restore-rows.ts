import { RESTORE_TABLE_ORDER } from "@/lib/backup/backup-modules";
import type { BackupRow } from "@/lib/backup/backup-file";
import { isMissingSchemaTableError } from "@/lib/backup/schema-cache";

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

  return {};
}

const MAX_COLUMN_STRIPS = 10;

const COLUMN_ERROR_PATTERNS = [
  /cannot insert a non-DEFAULT value into column "([^"]+)"/i,
  /column "([^"]+)" can only be updated to DEFAULT/i,
  /Could not find the '([^']+)' column/i,
];

const ON_CONFLICT_MISMATCH =
  /there is no unique or exclusion constraint matching the ON CONFLICT specification/i;

const DEFAULT_EXCLUDED: Record<string, string[]> = {
  mst_asset_categories: ["depreciation_rate"],
};

type StripState = {
  excluded: Set<string>;
  strips: number;
};

const stripStateByTable = new Map<string, StripState>();

type UpsertError = { message: string; code?: string };

type ChunkUpsert = (
  rows: BackupRow[],
  options?: UpsertOptions,
) => PromiseLike<{ error: UpsertError | null }>;

export type ChunkUpsertResult = {
  rows: number;
  excludedColumns: string[];
  skipped?: boolean;
  reason?: string;
};

function stateFor(table: string): StripState {
  const existing = stripStateByTable.get(table);
  if (existing) return existing;
  const created: StripState = {
    excluded: new Set(DEFAULT_EXCLUDED[table] ?? []),
    strips: 0,
  };
  stripStateByTable.set(table, created);
  return created;
}

export function stripColumns(rows: BackupRow[], columns: ReadonlySet<string>): BackupRow[] {
  if (columns.size === 0) return rows;
  return rows.map((row) => {
    const next: BackupRow = { ...row };
    for (const column of columns) delete next[column];
    return next;
  });
}

function columnFromUpsertError(message: string): string | null {
  for (const pattern of COLUMN_ERROR_PATTERNS) {
    const match = pattern.exec(message);
    if (match?.[1]) return match[1];
  }
  return null;
}

export async function upsertChunkWithAutoStrip(
  table: string,
  chunk: BackupRow[],
  options: UpsertOptions,
  upsert: ChunkUpsert,
): Promise<ChunkUpsertResult> {
  const state = stateFor(table);
  let rows = stripColumns(chunk, state.excluded);
  let onConflict = options.onConflict;
  let ignoreDuplicates = options.ignoreDuplicates;
  let droppedConflict = false;

  for (;;) {
    const upsertOptions: UpsertOptions = {};
    if (onConflict) {
      upsertOptions.onConflict = onConflict;
      if (ignoreDuplicates) upsertOptions.ignoreDuplicates = true;
    }

    const { error } = onConflict
      ? await upsert(rows, upsertOptions)
      : await upsert(rows);

    if (!error) {
      return { rows: rows.length, excludedColumns: [...state.excluded] };
    }

    const column = columnFromUpsertError(error.message);
    if (column) {
      if (!state.excluded.has(column) && state.strips < MAX_COLUMN_STRIPS) {
        state.excluded.add(column);
        state.strips += 1;
        rows = stripColumns(rows, state.excluded);
        continue;
      }
      throw new Error(error.message);
    }

    if (onConflict && !droppedConflict && ON_CONFLICT_MISMATCH.test(error.message)) {
      onConflict = undefined;
      ignoreDuplicates = undefined;
      droppedConflict = true;
      continue;
    }

    if (isMissingSchemaTableError(error)) {
      return {
        rows: 0,
        excludedColumns: [...state.excluded],
        skipped: true,
        reason: error.message,
      };
    }

    throw new Error(error.message);
  }
}
