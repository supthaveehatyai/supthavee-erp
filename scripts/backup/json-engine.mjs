/**
 * Supabase JSON backup / restore — ใช้เมื่อไม่มี pg_dump หรือ DATABASE_URL
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { pruneOlderThan } from "./pg-tools.mjs";
import { isMissingSchemaTableError } from "./schema-cache.mjs";
import { loadBackupCatalog } from "./load-backup-modules.mjs";

const PAGE_SIZE = 1000;
const UPSERT_BATCH = 500;

export function createBackupSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    throw new Error(
      "ไม่พบ NEXT_PUBLIC_SUPABASE_URL หรือ SUPABASE_SERVICE_ROLE_KEY",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function fetchAllRows(supabase, table) {
  const rows = [];
  let from = 0;
  while (true) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await supabase.from(table).select("*").range(from, to);
    if (error) {
      const wrapped = new Error(`${table}: ${error.message}`);
      wrapped.cause = error;
      throw wrapped;
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    from += PAGE_SIZE;
  }
}

export async function writeJsonBackup(options) {
  const {
    moduleName,
    tables,
    outDir,
    filename,
    retentionDays = null,
    baseDir,
  } = options;
  const supabase = createBackupSupabase();
  const shouldSkip = options.shouldSkipTableError ?? isMissingSchemaTableError;
  const data = {};
  const rowCounts = {};
  const skippedTables = [];
  const exportedTables = [];

  for (const table of tables) {
    process.stdout.write(`   → ${table} ... `);
    try {
      const rows = await fetchAllRows(supabase, table);
      data[table] = rows;
      rowCounts[table] = rows.length;
      exportedTables.push(table);
      console.log(`${rows.length} แถว`);
    } catch (error) {
      const cause = error?.cause ?? error;
      if (shouldSkip(cause) || shouldSkip(error)) {
        const reason = String(cause?.message || error?.message || "schema cache");
        skippedTables.push({ table, reason });
        console.warn(`⚠️ ข้าม ${table}: ${reason}`);
        continue;
      }
      throw error;
    }
  }

  const exportedAt = new Date().toISOString();
  const payload = {
    exportedAt,
    module: moduleName,
    tables: exportedTables,
    rowCounts,
    skipped_tables: skippedTables,
    data,
  };
  fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, filename);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  fs.writeFileSync(filepath, gz);

  const manifest = {
    createdAt: exportedAt,
    module: moduleName,
    tables: exportedTables,
    rowCounts,
    skipped_tables: skippedTables,
    bytes: gz.length,
    filename,
    kind: "json",
    engine: "supabase-js",
  };
  const manifestPath = path.join(
    outDir,
    filename.replace(/\.json\.gz$/, ".manifest.json"),
  );
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (retentionDays != null) {
    pruneOlderThan(outDir, retentionDays, baseDir);
  }

  const fileSizeInMB = (gz.length / (1024 * 1024)).toFixed(2);
  console.log(`✅ [JSON Backup] ${filename} (${fileSizeInMB} MB)`);
  return { filepath, manifestPath, bytes: gz.length, rowCounts, skippedTables };
}

export function readJsonBackup(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`ไม่พบไฟล์: ${absolute}`);
  }
  const compressed = fs.readFileSync(absolute);
  const text = absolute.endsWith(".gz")
    ? zlib.gunzipSync(compressed).toString("utf8")
    : compressed.toString("utf8");
  const payload = JSON.parse(text);
  return { absolute, payload };
}

/**
 * Upsert ทีละ 500 แถว ตามลำดับตารางที่ส่งมา (Parent → Child)
 */
function orderRestoreTables(tables, catalogOrder) {
  const rank = new Map((catalogOrder ?? []).map((table, index) => [table, index]));
  return [...tables].sort((left, right) => {
    const leftRank = rank.has(left) ? rank.get(left) : 10000;
    const rightRank = rank.has(right) ? rank.get(right) : 10000;
    if (leftRank !== rightRank) return leftRank - rightRank;
    return String(left).localeCompare(String(right));
  });
}

function rowsForRestore(table, rows) {
  if (table !== "mst_categories") return rows;
  return [...rows].sort((left, right) => {
    const leftRoot = left?.parent_id == null ? 0 : 1;
    const rightRoot = right?.parent_id == null ? 0 : 1;
    return leftRoot - rightRoot;
  });
}

const COLUMN_ERROR_PATTERNS = [
  /cannot insert a non-DEFAULT value into column "([^"]+)"/i,
  /column "([^"]+)" can only be updated to DEFAULT/i,
  /Could not find the '([^']+)' column/i,
];
const ON_CONFLICT_MISMATCH =
  /there is no unique or exclusion constraint matching the ON CONFLICT specification/i;
const KNOWN_GENERATED_COLUMNS = {
  mst_asset_categories: ["depreciation_rate"],
  expenses: ["grand_total"],
  expense_installments: ["total_installment"],
  fixed_assets: ["current_net_book_value"],
};

function upsertOptionsFor(table, firstRow, catalog) {
  if (table === "audit_logs") {
    return { onConflict: "id", ignoreDuplicates: true };
  }
  if (table === "system_parameters") return { onConflict: "param_key" };
  if (table === "app_roles") return { onConflict: "role_code" };
  if (table === "mst_uom") return { onConflict: "uom_id" };
  if (table === "mst_carriers") return { onConflict: "carrier_id" };
  if (firstRow && firstRow.id != null && firstRow.id !== "") {
    return { onConflict: "id" };
  }
  if (typeof catalog.upsertConflictColumn === "function") {
    const conflict = catalog.upsertConflictColumn(table);
    if (conflict !== "id" && firstRow && firstRow[conflict] != null && firstRow[conflict] !== "") {
      return { onConflict: conflict };
    }
  }
  return null;
}

function columnFromUpsertError(message) {
  for (const pattern of COLUMN_ERROR_PATTERNS) {
    const match = pattern.exec(message ?? "");
    if (match?.[1]) return match[1];
  }
  return null;
}

async function upsertChunkWithAutoStrip(supabase, table, chunk, options, state) {
  let rows = chunk.map((row) => {
    const next = { ...row };
    for (const column of state.excluded) delete next[column];
    return next;
  });
  let onConflict = options?.onConflict;
  let ignoreDuplicates = options?.ignoreDuplicates;
  let droppedConflict = false;

  for (;;) {
    const upsertOptions = {};
    if (onConflict) {
      upsertOptions.onConflict = onConflict;
      if (ignoreDuplicates) upsertOptions.ignoreDuplicates = true;
    }
    const { error } = onConflict
      ? await supabase.from(table).upsert(rows, upsertOptions)
      : await supabase.from(table).upsert(rows);
    if (!error) return { skipped: false };

    const column = columnFromUpsertError(error.message);
    if (column) {
      if (!state.excluded.has(column) && state.strips < 10) {
        state.excluded.add(column);
        state.strips += 1;
        rows = rows.map((row) => {
          const next = { ...row };
          delete next[column];
          return next;
        });
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
    if (isMissingSchemaTableError(error)) return { skipped: true, reason: error.message };
    throw new Error(error.message);
  }
}

export async function upsertJsonBackup(supabase, payload, tables) {
  const catalog = await loadBackupCatalog();
  const data = payload?.data ?? payload?.tables ?? {};
  const rowMap = data && !Array.isArray(data) ? data : {};
  const skippedTables = [];
  const ordered = orderRestoreTables(tables, catalog.RESTORE_TABLE_ORDER);

  for (const table of ordered) {
    const rows = rowsForRestore(
      table,
      Array.isArray(rowMap[table]) ? rowMap[table] : [],
    );
    if (rows.length === 0) {
      console.log(`   → ${table}: 0 แถว`);
      continue;
    }
    const upsertOptions = upsertOptionsFor(table, rows[0], catalog);
    const stripState = {
      excluded: new Set(KNOWN_GENERATED_COLUMNS[table] ?? []),
      strips: 0,
    };
    let skipped = false;
    for (let index = 0; index < rows.length; index += UPSERT_BATCH) {
      const batch = rows.slice(index, index + UPSERT_BATCH);
      try {
        const result = await upsertChunkWithAutoStrip(
          supabase,
          table,
          batch,
          upsertOptions,
          stripState,
        );
        if (result.skipped) {
          skippedTables.push({ table, reason: result.reason });
          console.warn(`⚠️ ข้าม ${table}: ${result.reason}`);
          skipped = true;
          break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`${table} แถว ${index + 1}: ${message}`);
      }
    }
    if (!skipped) console.log(`   → ${table}: upsert ${rows.length} แถว`);
  }

  return skippedTables;
}
