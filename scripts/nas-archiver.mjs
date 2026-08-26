/**
 * scripts/nas-archiver.mjs
 * Phase 14 — Local Worker: archive cold payment_slips from Supabase Storage → NAS disk
 *
 * Safety rule (STRICT):
 *   Download + verify MUST succeed before UPDATE DB or DELETE from Cloud.
 *   Any download failure → skip row (no DB change, no cloud delete).
 *
 * Usage:
 *   node scripts/nas-archiver.mjs
 *   ARCHIVE_DRY_RUN=1 node scripts/nas-archiver.mjs
 *
 * Env (.env.production via scripts/backup/load-env.mjs):
 *   NEXT_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { checkEnv } from "./backup/load-env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "..");

checkEnv(["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]);

const DRY_RUN = process.env.ARCHIVE_DRY_RUN === "1";
const COLD_AGE_DAYS = Number(process.env.ARCHIVE_COLD_AGE_DAYS || 365);
const BATCH_LIMIT = Number(process.env.ARCHIVE_BATCH_LIMIT || 200);
const LOCAL_SLIPS_DIR = path.resolve(PROJECT_ROOT, "nas_storage", "slips");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { persistSession: false, autoRefreshToken: false },
  },
);


/**
 * Parse Supabase public Storage URL → { bucket, objectPath }
 */
function parseStoragePublicUrl(rawUrl) {
  const url = String(rawUrl || "").trim();
  if (!url) return null;

  try {
    const u = new URL(url);
    const marker = "/storage/v1/object/public/";
    const idx = u.pathname.indexOf(marker);
    if (idx === -1) return null;

    const rest = u.pathname.slice(idx + marker.length);
    const slash = rest.indexOf("/");
    if (slash <= 0) return null;

    const bucket = decodeURIComponent(rest.slice(0, slash));
    const objectPath = decodeURIComponent(rest.slice(slash + 1));
    if (!bucket || !objectPath) return null;

    return { bucket, objectPath };
  } catch {
    return null;
  }
}

function coldCutoffIso(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function localRelativeNasUrl(absolutePath) {
  return path
    .relative(PROJECT_ROOT, absolutePath)
    .split(path.sep)
    .join("/");
}


/**
 * Download Storage object → local file, verify size > 0.
 * Throws on failure (caller must NOT update DB / delete cloud).
 */
async function downloadToLocal({ bucket, objectPath, destPath }) {
  ensureDir(path.dirname(destPath));

  const { data, error } = await supabase.storage
    .from(bucket)
    .download(objectPath);

  if (error) {
    throw new Error("storage.download failed: " + error.message);
  }
  if (!data) {
    throw new Error("storage.download returned empty body");
  }

  let nodeStream;
  if (typeof data.stream === "function") {
    nodeStream = Readable.fromWeb(data.stream());
  } else if (Buffer.isBuffer(data)) {
    nodeStream = Readable.from(data);
  } else if (data instanceof ArrayBuffer) {
    nodeStream = Readable.from(Buffer.from(data));
  } else if (typeof data.arrayBuffer === "function") {
    const ab = await data.arrayBuffer();
    nodeStream = Readable.from(Buffer.from(ab));
  } else {
    throw new Error("Unsupported download body type from supabase-js");
  }

  const tmpPath = destPath + ".partial";
  try {
    await pipeline(nodeStream, fs.createWriteStream(tmpPath));
    const stat = fs.statSync(tmpPath);
    if (!stat.isFile() || stat.size <= 0) {
      throw new Error("local file empty or missing after download (" + tmpPath + ")");
    }
    fs.renameSync(tmpPath, destPath);
    return { bytes: stat.size };
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      /* ignore */
    }
    throw err;
  }
}

async function markAsNas(rowId, nasArchiveUrl) {
  const { error } = await supabase
    .from("payment_slips")
    .update({
      storage_tier: "NAS",
      nas_archive_url: nasArchiveUrl,
    })
    .eq("id", rowId)
    .eq("storage_tier", "CLOUD");

  if (error) {
    throw new Error("DB update failed: " + error.message);
  }
}

async function deleteCloudObject(bucket, objectPath) {
  const { error } = await supabase.storage.from(bucket).remove([objectPath]);
  if (error) {
    throw new Error("storage.remove failed: " + error.message);
  }
}

async function fetchColdCloudSlips() {
  const cutoff = coldCutoffIso(COLD_AGE_DAYS);

  const { data, error } = await supabase
    .from("payment_slips")
    .select(
      "id, created_at, slip_image_url, storage_tier, nas_archive_url, reference_no",
    )
    .eq("storage_tier", "CLOUD")
    .lt("created_at", cutoff)
    .not("slip_image_url", "is", null)
    .order("created_at", { ascending: true })
    .limit(BATCH_LIMIT);

  if (error) {
    throw new Error("Query payment_slips failed: " + error.message);
  }

  return data ?? [];
}


async function archiveOne(row) {
  const id = row.id;
  const cloudUrl = (row.slip_image_url || "").trim();

  if (!cloudUrl) {
    return { status: "skipped", reason: "empty slip_image_url" };
  }

  const parsed = parseStoragePublicUrl(cloudUrl);
  if (!parsed) {
    return {
      status: "skipped",
      reason:
        "unparseable slip_image_url (need /storage/v1/object/public/...): " +
        cloudUrl.slice(0, 120),
    };
  }

  const { bucket, objectPath } = parsed;
  const baseName = path.basename(objectPath) || id + ".bin";
  const created = row.created_at ? new Date(row.created_at) : new Date();
  const yyyy = String(created.getUTCFullYear());
  const mm = String(created.getUTCMonth() + 1).padStart(2, "0");
  const destPath = path.join(LOCAL_SLIPS_DIR, yyyy, mm, id + "_" + baseName);
  const nasArchiveUrl = localRelativeNasUrl(destPath);

  if (DRY_RUN) {
    console.log(
      "   [DRY] would archive " +
        id +
        "  " +
        bucket +
        "/" +
        objectPath +
        " → " +
        nasArchiveUrl,
    );
    return { status: "dry_run", nasArchiveUrl, bucket, objectPath };
  }

  // Step 1: Download + verify (MUST succeed before any mutation)
  let downloadResult;
  try {
    downloadResult = await downloadToLocal({ bucket, objectPath, destPath });
  } catch (err) {
    return {
      status: "download_failed",
      reason: err.message,
      bucket,
      objectPath,
    };
  }

  // Step 2: Update DB (only after verified local file)
  try {
    await markAsNas(id, nasArchiveUrl);
  } catch (err) {
    return {
      status: "db_failed",
      reason: err.message,
      localPath: destPath,
      bytes: downloadResult.bytes,
    };
  }

  // Step 3: Delete cloud object (only after DB commit)
  try {
    await deleteCloudObject(bucket, objectPath);
  } catch (err) {
    return {
      status: "cloud_delete_failed",
      reason: err.message,
      nasArchiveUrl,
      bytes: downloadResult.bytes,
    };
  }

  return {
    status: "archived",
    nasArchiveUrl,
    bytes: downloadResult.bytes,
    bucket,
    objectPath,
  };
}


async function main() {
  console.log("🚀 [NAS Archiver] Phase 14 — payment_slips cold archive");
  console.log("   DRY_RUN=" + (DRY_RUN ? "1" : "0"));
  console.log("   COLD_AGE_DAYS=" + COLD_AGE_DAYS);
  console.log("   BATCH_LIMIT=" + BATCH_LIMIT);
  console.log("   LOCAL_DIR=" + LOCAL_SLIPS_DIR);
  console.log("   CUTOFF=< " + coldCutoffIso(COLD_AGE_DAYS));

  ensureDir(LOCAL_SLIPS_DIR);

  const rows = await fetchColdCloudSlips();
  console.log("\n📋 Candidates: " + rows.length + " row(s)\n");

  const summary = {
    archived: 0,
    dry_run: 0,
    skipped: 0,
    download_failed: 0,
    db_failed: 0,
    cloud_delete_failed: 0,
  };

  for (const row of rows) {
    const label = row.reference_no || row.id;
    process.stdout.write("→ " + label + " ... ");

    try {
      const result = await archiveOne(row);
      summary[result.status] = (summary[result.status] || 0) + 1;

      if (result.status === "archived") {
        console.log(
          "✅ NAS (" +
            (result.bytes / 1024).toFixed(1) +
            " KB) → " +
            result.nasArchiveUrl,
        );
      } else if (result.status === "dry_run") {
        console.log("🧪 dry-run ok");
      } else if (result.status === "skipped") {
        console.log("⏭️  skip — " + result.reason);
      } else if (result.status === "download_failed") {
        console.log("❌ download failed — " + result.reason);
        console.log("   ⛔ DB NOT updated · Cloud NOT deleted (safety lock)");
      } else if (result.status === "db_failed") {
        console.log("❌ DB update failed — " + result.reason);
        console.log("   ⛔ Cloud NOT deleted (local file retained for retry)");
      } else if (result.status === "cloud_delete_failed") {
        console.log(
          "⚠️  archived + DB updated, but cloud delete failed — " +
            result.reason,
        );
      } else {
        console.log("ℹ️  " + result.status);
      }
    } catch (err) {
      summary.download_failed += 1;
      console.log("❌ unexpected — " + err.message);
      console.log("   ⛔ DB NOT updated · Cloud NOT deleted (safety lock)");
    }
  }

  console.log("\n──────── Summary ────────");
  console.log(JSON.stringify(summary, null, 2));
  console.log("✨ [NAS Archiver] done");

  const hardFail = summary.download_failed + summary.db_failed;
  if (hardFail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error("💥 [NAS Archiver] fatal:", err.message || err);
  process.exit(1);
});
