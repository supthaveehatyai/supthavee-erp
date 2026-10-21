/**
 * Supabase JSON backup / restore — ใช้เมื่อไม่มี pg_dump หรือ DATABASE_URL
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { pruneOlderThan } from "./pg-tools.mjs";

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
    if (error) throw new Error(`${table}: ${error.message}`);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    from += PAGE_SIZE;
  }
}

export async function writeJsonBackup({
  moduleName,
  tables,
  outDir,
  filename,
  retentionDays = null,
  baseDir,
}) {
  const supabase = createBackupSupabase();
  const data = {};
  const rowCounts = {};

  for (const table of tables) {
    process.stdout.write(`   → ${table} ... `);
    const rows = await fetchAllRows(supabase, table);
    data[table] = rows;
    rowCounts[table] = rows.length;
    console.log(`${rows.length} แถว`);
  }

  const exportedAt = new Date().toISOString();
  const payload = { exportedAt, module: moduleName, tables, rowCounts, data };
  fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, filename);
  const gz = zlib.gzipSync(Buffer.from(JSON.stringify(payload), "utf8"));
  fs.writeFileSync(filepath, gz);

  const manifest = {
    createdAt: exportedAt,
    module: moduleName,
    tables,
    rowCounts,
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
  return { filepath, manifestPath, bytes: gz.length, rowCounts };
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
export async function upsertJsonBackup(supabase, payload, tables) {
  const data = payload?.data ?? {};
  for (const table of tables) {
    const rows = Array.isArray(data[table]) ? data[table] : [];
    if (rows.length === 0) {
      console.log(`   → ${table}: 0 แถว`);
      continue;
    }
    for (let index = 0; index < rows.length; index += UPSERT_BATCH) {
      const batch = rows.slice(index, index + UPSERT_BATCH);
      const { error } = await supabase.from(table).upsert(batch);
      if (error) {
        throw new Error(`${table} แถว ${index + 1}: ${error.message}`);
      }
    }
    console.log(`   → ${table}: upsert ${rows.length} แถว`);
  }
}
