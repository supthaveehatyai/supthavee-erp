/**
 * โหลด lib/backup/backup-modules.ts จากสคริปต์ Node โดยไม่ต้องใช้ tsx
 * ไฟล์ TypeScript เป็นแหล่งรายชื่อตารางเดียว
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const SOURCE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../lib/backup/backup-modules.ts",
);

function stripTypes(source) {
  return source
    .replace(/^\s*export type .+$/gm, "")
    .replace(/\s+as const/g, "")
    .replace(/:\s*Record<BackupModuleSelection,\s*string>/g, "")
    .replace(/:\s*value is BackupModuleSelection/g, "")
    .replace(/:\s*BackupModuleSelection/g, "")
    .replace(/:\s*BackupModuleKey/g, "")
    .replace(/:\s*string\[\]/g, "")
    .replace(/:\s*string\b/g, "");
}

export async function loadBackupCatalog() {
  const source = fs.readFileSync(SOURCE, "utf8");
  const js = stripTypes(source);
  const hash = crypto.createHash("sha256").update(js).digest("hex").slice(0, 16);
  const out = path.join(os.tmpdir(), `supthavee-backup-modules-${hash}.mjs`);
  if (!fs.existsSync(out)) {
    fs.writeFileSync(out, js, "utf8");
  }
  return import(pathToFileURL(out).href);
}
