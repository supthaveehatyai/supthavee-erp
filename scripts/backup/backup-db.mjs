// scripts/backup/backup-db.mjs
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import zlib from "zlib";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


/**
 * Load .env.production locally; on Vercel/production use injected env only.
 */
async function ensureBackupEnv(requiredKeys) {
  const skipLoadEnv =
    process.env.VERCEL === "1" || process.env.NODE_ENV === "production";

  if (!skipLoadEnv) {
    try {
      const { checkEnv } = await import("./load-env.mjs");
      checkEnv(requiredKeys);
      return;
    } catch (err) {
      console.warn(
        `[backup] Could not import load-env.mjs (${err.message}); validating injected env only.`,
      );
    }
  }

  const missing = requiredKeys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `❌ [Error] Missing required environment variables: ${missing.join(", ")}`,
    );
    process.exit(1);
  }
}


async function runDatabaseBackup() {
  await ensureBackupEnv(["DATABASE_URL"]);

  const BACKUP_DIR = path.resolve(__dirname, "../../backups/db");
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`📁 [System] Created backup directory at: ${BACKUP_DIR}`);
  }

  const date = new Date();
  const timestamp = date
    .toISOString()
    .replace(/[:.]/g, "-")
    .split("T")
    .join("_")
    .slice(0, 15);
  const filename = `supthavee_erp_db_backup_${timestamp}.sql.gz`;
  const filepath = path.join(BACKUP_DIR, filename);

  console.log(
    "📦 [Database Backup] Starting backup process using Node.js Streams...",
  );
  console.log(
    "⏳ Please wait, this might take a moment depending on database size.",
  );

  const dbUrl = process.env.DATABASE_URL;

  const args = [
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-privileges",
    dbUrl,
  ];

  const dumpProcess = spawn("pg_dump", args);
  const gzipStream = zlib.createGzip();
  const fileWriteStream = fs.createWriteStream(filepath);

  dumpProcess.stdout.pipe(gzipStream).pipe(fileWriteStream);

  dumpProcess.stderr.on("data", (data) => {
    const msg = data.toString();
    if (!msg.toLowerCase().includes("warning")) {
      console.log(`ℹ️ [pg_dump log]: ${msg.trim()}`);
    }
  });

  dumpProcess.on("close", (code) => {
    if (code === 0) {
      const stats = fs.statSync(filepath);
      const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
      console.log("✅ [Database Backup] Success!");
      console.log(`📄 File: ${filename}`);
      console.log(`💾 Size: ${fileSizeInMB} MB`);
      console.log(`📍 Location: ${filepath}`);
    } else {
      console.error(`❌ [Database Backup] Failed with exit code ${code}`);
      process.exit(1);
    }
  });

  dumpProcess.on("error", (err) => {
    console.error("❌ [Error] Failed to start pg_dump. Reason:", err.message);
    process.exit(1);
  });
}

runDatabaseBackup().catch((err) => {
  console.error("💥 [Database Backup] fatal:", err.message || err);
  process.exit(1);
});
