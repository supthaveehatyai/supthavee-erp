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

function upsertOptionsFor(table, firstRow, catalog) {
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
    return null;
  }
  const conflict =
    typeof catalog.upsertConflictColumn === "function"
      ? catalog.upsertConflictColumn(table)
      : "id";
  return { onConflict: conflict };
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
    let skipped = false;
    for (let index = 0; index < rows.length; index += UPSERT_BATCH) {
      const batch = rows.slice(index, index + UPSERT_BATCH);
      const { error } = upsertOptions
        ? await supabase.from(table).upsert(batch, upsertOptions)
        : await supabase.from(table).upsert(batch);
      if (error && isMissingSchemaTableError(error)) {
        skippedTables.push({ table, reason: error.message });
        console.warn(`⚠️ ข้าม ${table}: ${error.message}`);
        skipped = true;
        break;
      }
      if (error) {
        throw new Error(`${table} แถว ${index + 1}: ${error.message}`);
      }
    }
    if (!skipped) console.log(`   → ${table}: upsert ${rows.length} แถว`);
  }

  return skippedTables;
}
