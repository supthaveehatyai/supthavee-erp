// scripts/backup/restore-db.mjs
/**
 * กู้คืนจาก .json / .json.gz (Supabase upsert) หรือ .sql / .sql.gz (psql)
 *
 * หากไม่ได้ใส่ --dry-run ต้องใส่ --confirm-restore
 * ก่อนเขียนทับจะสร้าง pre_restore_<timestamp>.json.gz เสมอ
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBackupSupabase,
  readJsonBackup,
  upsertJsonBackup,
  writeJsonBackup,
} from "./json-engine.mjs";
import {
  backupTimestamp,
  ensureBackupEnv,
  readSqlFile,
  resolveBaseDir,
  resolveModuleTables,
  runPsql,
  tryResolvePgBinary,
  wrapRestoreSql,
} from "./pg-tools.mjs";
import fs from "node:fs";

const __filename = fileURLToPath(import.meta.url);

function parseArgs(argv) {
  const out = {
    file: "",
    moduleName: "all",
    dryRun: false,
    confirmRestore: false,
  };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--confirm-restore") out.confirmRestore = true;
    else if (arg.startsWith("--file=")) {
      out.file = arg.slice("--file=".length).trim().replace(/^["']|["']$/g, "");
    } else if (arg.startsWith("--module=")) {
      out.moduleName = arg.slice("--module=".length).trim();
    } else if (arg === "--help") out.help = true;
    else throw new Error(`ไม่รู้จักอาร์กิวเมนต์ ${arg}`);
  }
  return out;
}

function backupKind(filePath) {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".json") || lower.endsWith(".json.gz")) return "json";
  if (lower.endsWith(".sql") || lower.endsWith(".sql.gz")) return "sql";
  throw new Error("รองรับเฉพาะไฟล์ .json, .json.gz, .sql หรือ .sql.gz");
}

function readSiblingManifest(filePath) {
  const candidates = [
    filePath.replace(/\.sql\.gz$/i, ".manifest.json"),
    filePath.replace(/\.json\.gz$/i, ".manifest.json"),
    filePath.replace(/\.sql$/i, ".manifest.json"),
    filePath.replace(/\.json$/i, ".manifest.json"),
  ];
  const found = candidates.find(
    (item) => item !== filePath && fs.existsSync(item),
  );
  if (!found) return null;
  return JSON.parse(fs.readFileSync(found, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      "Usage: node scripts/backup/restore-db.mjs --file=<path> --module=all|settings_rbac|master|sales_inventory|finance_audit (--dry-run | --confirm-restore)",
    );
    return;
  }

  if (!args.dryRun && !args.confirmRestore) {
    console.error(
      "❌ ปฏิเสธการ Restore — หากไม่ได้ระบุ --dry-run ต้องระบุ --confirm-restore เสมอ",
    );
    process.exit(1);
  }

  if (!args.file) {
    console.error("❌ ต้องระบุ --file=<path_to_backup_file>");
    process.exit(1);
  }

  await ensureBackupEnv([]);
  const kind = backupKind(args.file);
  const { moduleName, tables } = await resolveModuleTables(args.moduleName);
  const manifest = readSiblingManifest(path.resolve(args.file));

  let jsonPayload = null;
  let sql = "";
  let absolute = path.resolve(args.file);
  if (kind === "json") {
    const loaded = readJsonBackup(args.file);
    absolute = loaded.absolute;
    jsonPayload = loaded.payload;
    if (jsonPayload.module && jsonPayload.module !== moduleName) {
      throw new Error(
        `โมดูลในไฟล์คือ ${jsonPayload.module} แต่คำสั่งระบุ ${moduleName}`,
      );
    }
  } else {
    const loaded = readSqlFile(args.file);
    absolute = loaded.absolute;
    sql = loaded.sql;
  }

  if (manifest?.module && manifest.module !== moduleName) {
    throw new Error(
      `โมดูลใน manifest คือ ${manifest.module} แต่คำสั่งระบุ ${moduleName}`,
    );
  }

  console.log(`📄 ไฟล์: ${absolute}`);
  console.log(`🧩 โหมด: ${kind} / โมดูล ${moduleName} (${tables.length} ตาราง)`);

  if (args.dryRun) {
    if (jsonPayload) {
      const counts = jsonPayload.rowCounts ?? {};
      console.log(JSON.stringify(counts, null, 2));
    } else {
      console.log(`📏 SQL ${sql.length.toLocaleString("en-US")} bytes`);
      console.log(sql.split(/\r?\n/).slice(0, 8).join("\n"));
    }
    console.log("✅ [dry-run] ไม่เขียนทับฐานข้อมูล และไม่สร้าง snapshot");
    return;
  }

  if (kind === "sql") {
    if (!process.env.DATABASE_URL?.trim()) {
      throw new Error("กู้คืนไฟล์ SQL ต้องมี DATABASE_URL");
    }
    if (!tryResolvePgBinary("psql")) {
      throw new Error(
        "ไม่พบ psql ใน PATH หรือ Docker — กู้คืนไฟล์ .sql ไม่ได้",
      );
    }
  }

  const baseDir = await resolveBaseDir();
  const snapshotDir = path.join(baseDir, "db", "pre_restore_snapshots");
  const snapshotName = `pre_restore_${backupTimestamp()}.json.gz`;
  const allTables = (await resolveModuleTables("all")).tables;
  console.log("🛟 [Pre-Restore] กำลังสำรองข้อมูลปัจจุบันเป็น JSON...");

  try {
    const snapshot = await writeJsonBackup({
      moduleName: "all",
      tables: allTables,
      outDir: snapshotDir,
      filename: snapshotName,
      retentionDays: null,
      baseDir,
    });
    console.log(`🛟 [Pre-Restore] snapshot: ${snapshot.filepath}`);
  } catch (error) {
    console.error("❌ [Pre-Restore] สำรองข้อมูลปัจจุบันไม่สำเร็จ — ยกเลิก Restore");
    throw error;
  }

  if (kind === "json") {
    console.log("♻️  [Restore] Upsert ตามลำดับ Foreign Key...");
    await upsertJsonBackup(createBackupSupabase(), jsonPayload, tables);
    console.log("✅ [Restore] Upsert สำเร็จ");
    return;
  }

  console.log("♻️  [Restore] เริ่มเขียน SQL ภายใน Transaction...");
  await runPsql(wrapRestoreSql(sql));
  console.log("✅ [Restore] สำเร็จ และ COMMIT แล้ว");
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(__filename);

if (invokedDirectly) {
  main().catch((err) => {
    console.error("💥 [Restore] fatal:", err.message || err);
    process.exit(1);
  });
}
