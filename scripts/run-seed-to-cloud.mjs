/**
 * Apply `cloud_master_data.sql` ตรงเข้า Production (ไม่ผ่าน Local DB)
 *
 * Usage:
 *   npm run seed-to-cloud -- --dry-run
 *   npm run seed-to-cloud -- --confirm-go-live
 *   npm run seed-to-cloud -- --confirm-go-live --allow-cascade
 *
 * เชื่อมด้วย DATABASE_URL ใน `.env.production` (Direct Postgres พอร์ต 5432)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENV_PATH = resolve(ROOT, ".env.production");
const SEED_PATH = resolve(ROOT, "cloud_master_data.sql");

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

const TRANSACTION_TABLES = [
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
];

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const CONFIRMED = args.has("--confirm-go-live");
const ALLOW_CASCADE = args.has("--allow-cascade");

function fail(message, detail) {
  console.error(`❌ ${message}`);
  if (detail) console.error(`   ${String(detail).trim()}`);
  process.exit(1);
}

function redactDbUrl(url) {
  return url.replace(/:([^:@/]+)@/, ":***@");
}

function isLocalDbUrl(url) {
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|:54322\b/i.test(url);
}

function run(bin, cmdArgs, input) {
  return spawnSync(bin, cmdArgs, {
    encoding: "utf8",
    shell: false,
    maxBuffer: 64 * 1024 * 1024,
    input: input ?? undefined,
  });
}

function resolvePsql() {
  const local = run("psql", ["--version"]);
  if (!local.error) return { bin: "psql", prefix: [] };

  if (local.error?.code !== "ENOENT") {
    fail("รัน psql ไม่สำเร็จ", local.error.message);
  }

  const ps = run("docker", [
    "ps",
    "--format",
    "{{.Names}}",
    "--filter",
    "name=supabase_db_",
  ]);
  const container = ps.stdout
    ?.trim()
    .split(/\r?\n/)
    .find((name) => name.includes("supabase_db_"));

  if (!container) {
    fail(
      "ไม่พบ psql ใน PATH และไม่พบ Docker container supabase_db_*",
      "ติดตั้ง PostgreSQL client (psql) หรือรัน `npx supabase start` แล้วลองใหม่",
    );
  }

  console.log(`ℹ️  psql ไม่ใน PATH — ใช้ docker exec ${container}`);
  return { bin: "docker", prefix: ["exec", "-i", container, "psql"] };
}

function runPsql(psql, dbUrl, sql, extraArgs = []) {
  return run(
    psql.bin,
    [
      ...psql.prefix,
      dbUrl,
      "-v",
      "ON_ERROR_STOP=1",
      "--pset",
      "pager=off",
      ...extraArgs,
      "-f",
      "-",
    ],
    sql,
  );
}

function parseInsertTargets(sql) {
  const tables = new Set();
  const re = /INSERT\s+INTO\s+(?:public\.)?([a-zA-Z_][a-zA-Z0-9_]*)/gi;
  for (const match of sql.matchAll(re)) {
    tables.add(match[1].toLowerCase());
  }
  return [...tables];
}

function explainPsqlFailure(stderr, status) {
  const text = String(stderr || "").trim();
  if (/could not connect|connection refused|timeout|password authentication|SSL/i.test(text)) {
    return {
      title: "เชื่อมต่อ Production Database ไม่สำเร็จ",
      detail:
        text ||
        "ตรวจ DATABASE_URL ใน .env.production (ต้องเป็น Direct connection พอร์ต 5432 ไม่ใช่ Pooler :6543)",
    };
  }
  if (/violates foreign key constraint/i.test(text)) {
    return {
      title: "TRUNCATE/INSERT ชน Foreign Key จากตารางธุรกรรม",
      detail:
        `${text}\n   ล้างเอกสาร/สต็อกก่อน หรือรันพร้อม --allow-cascade (จะลบแถวลูกด้วย)`,
    };
  }
  if (/duplicate key value|unique constraint/i.test(text)) {
    return {
      title: "INSERT ชน Unique / Primary Key",
      detail: text,
    };
  }
  return {
    title: "รัน SQL บน Production ไม่สำเร็จ",
    detail: text || `psql exit code ${status}`,
  };
}

if (!DRY_RUN && !CONFIRMED) {
  fail(
    "สคริปต์นี้ยิงเข้า Production — ต้องยืนยันก่อน",
    "ใช้ `npm run seed-to-cloud -- --dry-run` หรือ `npm run seed-to-cloud -- --confirm-go-live`",
  );
}

if (!existsSync(ENV_PATH)) {
  fail("ไม่พบไฟล์ .env.production", ENV_PATH);
}
if (!existsSync(SEED_PATH)) {
  fail("ไม่พบไฟล์ cloud_master_data.sql", "รัน `npm run generate-cloud-seed` ก่อน");
}

dotenv.config({ path: ENV_PATH });
const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
if (!dbUrl) {
  fail(
    "ไม่พบ DATABASE_URL ใน .env.production",
    "ใช้ Direct connection พอร์ต 5432 (ไม่ใช่ Transaction Pooler :6543)",
  );
}
if (isLocalDbUrl(dbUrl)) {
  fail(
    "DATABASE_URL ชี้ไป Local DB — สคริปต์นี้ยิงเข้า Production เท่านั้น",
    redactDbUrl(dbUrl),
  );
}

const seedSql = readFileSync(SEED_PATH, "utf8");
if (!seedSql.trim()) {
  fail("ไฟล์ cloud_master_data.sql ว่างเปล่า");
}

const insertTables = parseInsertTargets(seedSql);
if (insertTables.length === 0) {
  fail("ไม่พบคำสั่ง INSERT INTO ใน cloud_master_data.sql");
}

const blocked = insertTables.filter((t) => TRANSACTION_TABLES.includes(t));
if (blocked.length > 0) {
  fail(
    "ไฟล์ SQL มี INSERT ตารางธุรกรรม — ยกเลิกเพื่อกันยิงบิล/สต็อกเข้า Production",
    blocked.join(", "),
  );
}

const truncateList = WHITELIST.map((t) => `public.${t}`).join(",\n  ");
const truncateSql = `TRUNCATE TABLE\n  ${truncateList}\nRESTART IDENTITY${ALLOW_CASCADE ? " CASCADE" : ""};`;

const preflightSql = `
SELECT table_name, n
FROM (
${TRANSACTION_TABLES.map(
  (t) =>
    `  SELECT '${t}' AS table_name, COUNT(*)::bigint AS n FROM public.${t}`,
).join("\n  UNION ALL\n")}
) s
ORDER BY n DESC, table_name;
`;

console.log(`☁️  Target: ${redactDbUrl(dbUrl)}`);
console.log(`📄 Seed:   ${SEED_PATH}`);
console.log(`🧹 Truncate Master Data (${WHITELIST.length} tables)${ALLOW_CASCADE ? " CASCADE" : ""}`);
console.log(`📥 INSERT tables: ${insertTables.join(", ")}`);

const psql = resolvePsql();

console.log("🔎 Preflight: นับแถวตารางธุรกรรม...");
const preflight = runPsql(psql, dbUrl, preflightSql, ["-A", "-t", "-F", "|"]);
if (preflight.error?.code === "ENOENT") {
  fail("ไม่พบคำสั่ง psql / docker", preflight.error.message);
}
if (preflight.status !== 0) {
  const err = explainPsqlFailure(preflight.stderr || preflight.error?.message, preflight.status);
  fail(err.title, err.detail);
}

const txCounts = [];
for (const line of (preflight.stdout || "").split(/\r?\n/)) {
  const match = line.trim().match(/^([a-z_]+)\|(\d+)$/i);
  if (match) txCounts.push({ table: match[1], n: Number(match[2]) });
}

const dirty = txCounts.filter((row) => row.n > 0);
if (dirty.length > 0) {
  console.log("⚠️  พบข้อมูลธุรกรรมบน Production:");
  for (const row of dirty) {
    console.log(`   - ${row.table}: ${row.n.toLocaleString("th-TH")} แถว`);
  }
  if (!ALLOW_CASCADE) {
    fail(
      "ห้าม Reset Master Data ทับขณะยังมีเอกสาร/สต็อก (FK จะบล็อก TRUNCATE)",
      "ล้างธุรกรรมก่อน หรือถ้ายอมลบแถวลูกทั้งหมดให้เพิ่ม --allow-cascade",
    );
  }
  console.log("⚠️  --allow-cascade เปิดอยู่: TRUNCATE จะลบแถวที่อ้างอิง Master Data ด้วย");
} else {
  console.log("✅ ไม่พบแถวในตารางธุรกรรมที่เช็ก");
}

if (DRY_RUN) {
  console.log("🧪 Dry-run เท่านั้น — ยังไม่เขียน Production");
  process.exit(0);
}

const payload = `-- run-seed-to-cloud.mjs
BEGIN;

${truncateSql}

${seedSql}

COMMIT;
`;

console.log("🚀 Applying seed to Production...");
const applied = runPsql(psql, dbUrl, payload);
if (applied.status !== 0) {
  const err = explainPsqlFailure(applied.stderr || applied.error?.message, applied.status);
  fail(err.title, `${err.detail}\n   Transaction ถูก ROLLBACK แล้ว — ข้อมูลเดิมยังอยู่`);
}

if (applied.stderr?.trim()) {
  const noise = applied.stderr
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/NOTICE:/i.test(line))
    .join("\n")
    .trim();
  if (noise) console.log(noise);
}

console.log("✅ Reset Master Data บน Production สำเร็จ (Go-Live seed applied)");
console.log("   ตรวจ system_settings / contacts / products บน Cloud ก่อนเปิดใช้งานจริง");
