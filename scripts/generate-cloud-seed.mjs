/**
 * Export Master Data จาก Supabase Cloud → cloud_master_data.sql
 *
 * Usage: npm run generate-cloud-seed
 *
 * เชื่อมด้วย DATABASE_URL ใน `.env.production` (Direct Postgres URL พอร์ต 5432
 * — ห้ามใช้ Transaction Pooler พอร์ต 6543)
 */

import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = resolve(ROOT, ".env.production");
const OUT = resolve(ROOT, "cloud_master_data.sql");

/** ลำดับ FK-safe — ห้ามสลับ */
const WHITELIST = [
  "system_settings",
  "mst_bank_accounts",
  "mst_brands",
  "mst_categories",
  "mst_colors",
  "mst_expense_categories",
  "mst_genders",
  "mst_sizes",
  "contacts",
  "contact_persons",
  "product_models",
  "products",
  "technician_rates",
];

/** ตารางธุรกรรม — ห้าม dump เด็ดขาด */
const BLACKLIST = new Set([
  "documents",
  "doc_headers",
  "doc_details",
  "document_items",
  "document_allocations",
  "billing_note_items",
  "inventory_ledger",
  "production_jobs",
  "service_tracking",
  "payment_transactions",
  "payment_allocations",
  "payment_slips",
  "expenses",
  "audit_logs",
  "vendor_product_mapping",
]);

function fail(message, detail) {
  console.error(`❌ ${message}`);
  if (detail) console.error(`   ${String(detail).trim()}`);
  process.exit(1);
}

function redactDbUrl(url) {
  return url.replace(/:([^:@/]+)@/, ":***@");
}

function sanitizeSeedSql(sql) {
  return sql
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => !/^\\/.test(line.trim()))
    .filter((line) => !/^SET\s+transaction_timeout\b/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function runPgDump(bin, args) {
  return spawnSync(bin, args, { encoding: "utf8", shell: false, maxBuffer: 64 * 1024 * 1024 });
}

function resolvePgDump() {
  const local = runPgDump("pg_dump", ["--version"]);
  if (!local.error) return { bin: "pg_dump", prefix: [] };

  if (local.error?.code !== "ENOENT") {
    fail("รัน pg_dump ไม่สำเร็จ", local.error.message);
  }

  const ps = spawnSync(
    "docker",
    ["ps", "--format", "{{.Names}}", "--filter", "name=supabase_db_"],
    { encoding: "utf8", shell: false },
  );
  const container = ps.stdout
    ?.trim()
    .split(/\r?\n/)
    .find((name) => name.includes("supabase_db_"));

  if (!container) {
    fail(
      "ไม่พบ pg_dump ใน PATH และไม่พบ Docker container supabase_db_*",
      "ติดตั้ง PostgreSQL client (pg_dump) หรือรัน `npx supabase start` แล้วลองใหม่",
    );
  }

  console.log(`ℹ️  pg_dump ไม่ใน PATH — ใช้ docker exec ${container}`);
  return { bin: "docker", prefix: ["exec", "-i", container, "pg_dump"] };
}

function dumpTable(pgDump, dbUrl, table) {
  const args = [
    ...pgDump.prefix,
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--inserts",
    "--column-inserts",
    "--rows-per-insert=100",
    "-t",
    `public.${table}`,
    dbUrl,
  ];
  return runPgDump(pgDump.bin, args);
}

for (const table of WHITELIST) {
  if (BLACKLIST.has(table)) {
    fail("Whitelist ชนกับ Blacklist (ตารางธุรกรรม)", table);
  }
}

if (!existsSync(ENV_PATH)) {
  fail("ไม่พบไฟล์ .env.production", ENV_PATH);
}

dotenv.config({ path: ENV_PATH });
const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!dbUrl) {
  fail(
    "ไม่พบ DATABASE_URL ใน .env.production",
    "ใช้ Direct connection พอร์ต 5432 (ไม่ใช่ Transaction Pooler :6543)",
  );
}

console.log(`☁️  Cloud seed: ${redactDbUrl(dbUrl)}`);
console.log(`📋 Tables (${WHITELIST.length}): ${WHITELIST.join(", ")}`);

const pgDump = resolvePgDump();
const chunks = [];

for (const table of WHITELIST) {
  process.stdout.write(`   → ${table} ... `);
  const result = dumpTable(pgDump, dbUrl, table);

  if (result.error?.code === "ENOENT") {
    fail("ไม่พบคำสั่ง pg_dump / docker", result.error.message);
  }

  if (result.status !== 0) {
    const stderr = (result.stderr || result.error?.message || "").trim();
    const isConn =
      /could not connect|connection refused|timeout|password authentication|SSL/i.test(
        stderr,
      );
    fail(
      isConn
        ? `เชื่อมต่อ Cloud Database ไม่สำเร็จ (ตาราง ${table})`
        : `pg_dump ล้มเหลวที่ตาราง ${table}`,
      stderr || `exit code ${result.status}`,
    );
  }

  const body = sanitizeSeedSql(result.stdout || "");
  const insertCount = (body.match(/^INSERT INTO\b/gim) ?? []).length;
  console.log(`${insertCount} INSERT`);
  chunks.push(`-- ---------------------------------------------------------------------------\n-- public.${table}\n-- ---------------------------------------------------------------------------\n${body || `-- (no rows)`}`);
}

const header = `-- =============================================================================
-- Cloud Master Data (Go-Live review dump)
-- Generated at: ${new Date().toISOString()}
-- Source: .env.production DATABASE_URL
-- Tables: ${WHITELIST.join(", ")}
-- Excluded (transactions): ${[...BLACKLIST].join(", ")}
-- =============================================================================

`;

writeFileSync(OUT, `${header}${chunks.join("\n\n")}\n`, "utf8");
console.log(`✅ Wrote ${OUT}`);
console.log("   รีวิวไฟล์นี้ก่อนนำไปเป็น Seed / Go-Live");
