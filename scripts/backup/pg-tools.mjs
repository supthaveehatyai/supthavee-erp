/**
 * Shared pg_dump / psql helpers for NAS backup and restore.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { loadBackupCatalog } from "./load-backup-modules.mjs";

export function redactDbUrl(url) {
  return String(url).replace(/:([^:@/]+)@/, ":***@");
}

export function backupTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/**
 * โหลด .env.production เสมอเมื่อไม่ได้อยู่บน Vercel
 * ค่าที่ inject ไว้แล้วไม่ถูกทับ (dotenv ไม่ override)
 */
export async function ensureBackupEnv(requiredKeys) {
  if (process.env.VERCEL !== "1") {
    try {
      await import("./load-env.mjs");
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

export async function resolveBaseDir() {
  const { resolveBackupBaseDir } = await import("./load-env.mjs");
  return resolveBackupBaseDir();
}

export async function resolveModuleTables(moduleName) {
  const catalog = await loadBackupCatalog();
  if (!catalog.isBackupModuleSelection(moduleName)) {
    throw new Error(
      `โมดูลไม่ถูกต้อง: ${moduleName} (ใช้ all|settings_rbac|master|sales_inventory|finance_audit)`,
    );
  }
  return {
    moduleName,
    tables: catalog.tablesForModule(moduleName),
  };
}

function findSupabaseDbContainer() {
  const ps = spawnSync(
    "docker",
    ["ps", "--format", "{{.Names}}", "--filter", "name=supabase_db_"],
    { encoding: "utf8", shell: false },
  );
  return ps.stdout
    ?.trim()
    .split(/\r?\n/)
    .find((name) => name.includes("supabase_db_"));
}

export function tryResolvePgBinary(toolName) {
  const local = spawnSync(toolName, ["--version"], {
    encoding: "utf8",
    shell: false,
  });
  if (!local.error) return { bin: toolName, prefix: [] };

  if (local.error?.code !== "ENOENT") {
    console.warn(`⚠️ รัน ${toolName} ไม่สำเร็จ: ${local.error.message}`);
    return null;
  }

  const container = findSupabaseDbContainer();
  if (!container) return null;

  console.log(`ℹ️  ${toolName} ไม่ใน PATH — ใช้ docker exec ${container}`);
  return { bin: "docker", prefix: ["exec", "-i", container, toolName] };
}

export function resolvePgBinary(toolName) {
  const resolved = tryResolvePgBinary(toolName);
  if (!resolved) {
    throw new Error(
      `ไม่พบ ${toolName} ใน PATH และไม่พบ Docker container supabase_db_*`,
    );
  }
  return resolved;
}

function dumpArgs(tool, moduleName, tables, dbUrl) {
  if (moduleName === "all") {
    return [
      ...tool.prefix,
      "--schema=public",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-privileges",
      dbUrl,
    ];
  }

  const tableArgs = tables.flatMap((table) => ["-t", `public.${table}`]);
  return [
    ...tool.prefix,
    "--data-only",
    "--no-owner",
    "--no-privileges",
    "--inserts",
    "--column-inserts",
    "--rows-per-insert=100",
    ...tableArgs,
    dbUrl,
  ];
}

function spawnGzipDump(bin, args, filepath) {
  return new Promise((resolve, reject) => {
    const dump = spawn(bin, args, { shell: false, windowsHide: true });
    const gzip = zlib.createGzip();
    const out = fs.createWriteStream(filepath);
    let stderr = "";
    let code = null;
    let streamDone = false;
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      out.destroy();
      reject(error);
    };

    const succeed = () => {
      if (settled) return;
      if (code === 0 && streamDone) {
        settled = true;
        resolve(stderr);
      }
    };

    dump.stdout.pipe(gzip).pipe(out);
    dump.stderr.on("data", (chunk) => {
      const msg = chunk.toString();
      stderr += msg;
      if (!msg.toLowerCase().includes("warning")) {
        const line = msg.trim();
        if (line) console.log(`ℹ️ [pg_dump log]: ${line}`);
      }
    });
    dump.on("error", (error) => fail(error));
    out.on("error", (error) => fail(error));
    dump.on("close", (exitCode) => {
      code = exitCode ?? 1;
      if (code !== 0) {
        fail(new Error(stderr.trim() || `pg_dump exit ${code}`));
        return;
      }
      succeed();
    });
    out.on("finish", () => {
      streamDone = true;
      succeed();
    });
  });
}

export function pruneOlderThan(dir, retentionDays, baseDir) {
  const resolved = path.resolve(dir);
  const dbRoot = path.resolve(baseDir, "db");
  const relative = path.relative(dbRoot, resolved);
  if (!baseDir || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`ปฏิเสธการลบไฟล์นอกโฟลเดอร์ db/: ${resolved}`);
  }
  if (!fs.existsSync(resolved)) return;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  for (const name of fs.readdirSync(resolved)) {
    if (name.toLowerCase().endsWith(".csv")) continue;
    const isBackup =
      name.endsWith(".sql.gz") ||
      name.endsWith(".json.gz") ||
      name.endsWith(".manifest.json");
    if (!isBackup) continue;
    const full = path.join(resolved, name);
    const stat = fs.statSync(full);
    if (!stat.isFile() || stat.mtimeMs >= cutoff) continue;
    fs.unlinkSync(full);
    console.log(`🗑️  ลบไฟล์เก่า: ${name}`);
  }
}

/**
 * เขียนไฟล์ .sql.gz + .manifest.json
 * moduleName = all → schema dump, อื่นๆ → data-only ของตารางในโมดูล
 */
export async function writeDatabaseBackup({
  moduleName,
  tables,
  outDir,
  filename,
  retentionDays = null,
  baseDir,
}) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("ไม่พบ DATABASE_URL");
  }

  fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, filename);
  const tool = resolvePgBinary("pg_dump");
  const args = dumpArgs(tool, moduleName, tables, dbUrl);

  console.log(`📦 [Database Backup] module=${moduleName}`);
  console.log(`📍 ปลายทาง: ${filepath}`);
  console.log(`🔗 ${redactDbUrl(dbUrl)}`);

  try {
    await spawnGzipDump(tool.bin, args, filepath);
  } catch (error) {
    if (fs.existsSync(filepath)) fs.unlinkSync(filepath);
    throw error;
  }

  const stats = fs.statSync(filepath);
  if (stats.size <= 0) {
    fs.unlinkSync(filepath);
    throw new Error("ไฟล์ backup ว่าง — ยกเลิกการบันทึก manifest");
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    module: moduleName,
    tables,
    bytes: stats.size,
    filename,
    kind: moduleName === "all" ? "full" : "module",
    engine: "pg_dump",
  };
  const manifestPath = path.join(
    outDir,
    filename.replace(/\.sql\.gz$/, ".manifest.json"),
  );
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (retentionDays != null) {
    pruneOlderThan(outDir, retentionDays, baseDir);
  }

  const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
  console.log(`✅ [Database Backup] ${filename} (${fileSizeInMB} MB)`);
  return { filepath, manifestPath, bytes: stats.size };
}

export function readSqlFile(filePath) {
  const absolute = path.resolve(filePath);
  if (!fs.existsSync(absolute)) {
    throw new Error(`ไม่พบไฟล์: ${absolute}`);
  }
  const compressed = fs.readFileSync(absolute);
  const sql = absolute.endsWith(".gz")
    ? zlib.gunzipSync(compressed).toString("utf8")
    : compressed.toString("utf8");
  return { absolute, sql };
}

export function wrapRestoreSql(sql) {
  return [
    "BEGIN;",
    "SET session_replication_role = 'replica';",
    sql.trim(),
    "SET session_replication_role = 'origin';",
    "COMMIT;",
    "",
  ].join("\n");
}

export function runPsql(sql) {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("ไม่พบ DATABASE_URL");
  }
  const tool = resolvePgBinary("psql");
  const args = [
    ...tool.prefix,
    "--dbname",
    dbUrl,
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "-",
  ];

  return new Promise((resolve, reject) => {
    const child = spawn(tool.bin, args, {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "inherit", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `psql exit ${code}`));
    });
    child.stdin.write(sql);
    child.stdin.end();
  });
}
