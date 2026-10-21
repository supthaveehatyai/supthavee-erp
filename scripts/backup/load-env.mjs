// scripts/backup/load-env.mjs
import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadBackupCatalog } from "./load-backup-modules.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const ENV_CANDIDATES = [
  path.join(ROOT, ".env.production"),
  path.join(ROOT, ".env.local"),
  path.join(ROOT, ".env.development"),
];

const envFile = ENV_CANDIDATES.find((file) => fs.existsSync(file));
if (envFile) {
  dotenv.config({ path: envFile });
} else {
  console.warn(
    "⚠️ ไม่พบ .env.production, .env.local หรือ .env.development — ใช้ค่า environment ที่ inject ไว้",
  );
}

/**
 * @param {string[]} keys
 */
export const checkEnv = (keys) => {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error("❌ [Error] Missing required environment variables:");
    console.error(`   👉 ${missing.join(", ")}`);
    console.error(`   ตรวจไฟล์ ${envFile ?? ".env.production"}`);
    process.exit(1);
  }
};

/**
 * @returns {string} YYYYMMDD-HHmmss (local time)
 */
export function timestampStamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function canUseDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * 1) NAS_BACKUP_DIR หรือ GOOGLE_DRIVE_BACKUP_DIR หากสร้าง/เขียนได้
 * 2) H:\My Drive\STV_ERP_SuperApp\Backup เมื่อไดรฟ์ H:\My Drive มีอยู่
 * 3) โฟลเดอร์ backups/ ในโปรเจกต์ — ไม่ลบไฟล์ .csv ที่ root ของโฟลเดอร์ Backup
 */
export async function resolveBackupBaseDir() {
  const catalog = await loadBackupCatalog();
  const driveBackup = catalog.DEFAULT_GOOGLE_DRIVE_BACKUP_DIR;
  const configured = [
    process.env.NAS_BACKUP_DIR?.trim(),
    process.env.GOOGLE_DRIVE_BACKUP_DIR?.trim(),
  ].filter(Boolean);

  for (const dir of configured) {
    if (canUseDir(dir)) {
      console.log(`📍 ใช้โฟลเดอร์สำรอง: ${path.resolve(dir)}`);
      return path.resolve(dir);
    }
    console.warn(`⚠️ เข้าถึงโฟลเดอร์ที่กำหนดไว้ไม่ได้: ${dir}`);
  }

  const driveRoot = "H:\\My Drive";
  if (fs.existsSync(driveRoot) && canUseDir(driveBackup)) {
    console.log(`📍 ใช้ Google Drive: ${driveBackup}`);
    return driveBackup;
  }

  console.warn(
    "⚠️ ไม่สามารถเข้าถึงไดรฟ์ภายนอกหรือ Google Drive ได้ — สลับไปใช้โฟลเดอร์ backups/ ในโปรเจกต์ (ไม่แก้ไขไฟล์ .csv เดิมในโฟลเดอร์ Backup)",
  );
  const local = path.join(ROOT, "backups");
  fs.mkdirSync(local, { recursive: true });
  return local;
}

export function projectRoot() {
  return ROOT;
}

export default checkEnv;
