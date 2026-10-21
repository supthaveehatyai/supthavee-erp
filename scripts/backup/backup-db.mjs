// scripts/backup/backup-db.mjs
/**
 * Full หรือ Modular database backup ลง NAS (หรือโฟลเดอร์ backups)
 *
 * Usage:
 *   node scripts/backup/backup-db.mjs --module=all --retention-days=30
 *   node scripts/backup/backup-db.mjs --module=master
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  backupTimestamp,
  ensureBackupEnv,
  resolveBaseDir,
  resolveModuleTables,
  tryResolvePgBinary,
  writeDatabaseBackup,
} from "./pg-tools.mjs";
import { writeJsonBackup } from "./json-engine.mjs";

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const out = { moduleName: "all", retentionDays: 30 };
  for (const arg of argv) {
    if (arg.startsWith("--module=")) {
      out.moduleName = arg.slice("--module=".length).trim();
    } else if (arg.startsWith("--retention-days=")) {
      out.retentionDays = Number(arg.slice("--retention-days=".length));
    } else if (arg === "--help") {
      out.help = true;
    } else {
      throw new Error(`ไม่รู้จักอาร์กิวเมนต์ ${arg}`);
    }
  }
  if (!Number.isInteger(out.retentionDays) || out.retentionDays < 1) {
    throw new Error("--retention-days ต้องเป็นจำนวนเต็มมากกว่า 0");
  }
  return out;
}

export async function runDatabaseBackup(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(
      "Usage: node scripts/backup/backup-db.mjs --module=all|settings_rbac|master|sales_inventory|finance_audit --retention-days=30",
    );
    return;
  }

  await ensureBackupEnv([]);
  const { moduleName, tables } = await resolveModuleTables(args.moduleName);
  const baseDir = await resolveBaseDir();
  const outDir =
    moduleName === "all"
      ? path.join(baseDir, "db", "full")
      : path.join(baseDir, "db", "modules", moduleName);
  const stamp = backupTimestamp();
  const pgDump = tryResolvePgBinary("pg_dump");
  const dbUrl = process.env.DATABASE_URL?.trim();

  if (pgDump && dbUrl) {
    await writeDatabaseBackup({
      moduleName,
      tables,
      outDir,
      filename: `supthavee_erp_db_${moduleName}_${stamp}.sql.gz`,
      retentionDays: args.retentionDays,
      baseDir,
    });
    return;
  }

  console.warn(
    "⚠️ ไม่พบ pg_dump หรือ DATABASE_URL — ใช้ Supabase JSON backup (.json.gz) แทน",
  );
  await writeJsonBackup({
    moduleName,
    tables,
    outDir,
    filename: `supthavee_erp_db_${moduleName}_${stamp}.json.gz`,
    retentionDays: args.retentionDays,
    baseDir,
  });
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (invokedDirectly) {
  runDatabaseBackup().catch((err) => {
    console.error("💥 [Database Backup] fatal:", err.message || err);
    process.exit(1);
  });
}
