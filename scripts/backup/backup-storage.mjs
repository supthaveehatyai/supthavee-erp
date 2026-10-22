// scripts/backup/backup-storage.mjs
/**
 * Incremental mirror ของ Storage ลง NAS
 * ช่องทางหลัก: Supabase Storage API
 * ช่องทางสำรอง: S3 เมื่อตั้ง S3_ACCESS_KEY_ID และไม่มี Service Role
 *
 * Usage:
 *   node scripts/backup/backup-storage.mjs
 *   node scripts/backup/backup-storage.mjs --bucket=product_assets
 */
import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { createClient } from "@supabase/supabase-js";
import { ensureBackupEnv, resolveBaseDir } from "./pg-tools.mjs";

const TARGET_BUCKETS = [
  "document_attachments",
  "production_attachments",
  "expense_documents",
  "product_assets",
  "procurement_bills",
];

function parseArgs(argv) {
  let bucket = "";
  for (const arg of argv) {
    if (arg.startsWith("--bucket=")) bucket = arg.slice("--bucket=".length).trim();
    else if (arg === "--help") return { help: true, bucket: "" };
    else throw new Error(`ไม่รู้จักอาร์กิวเมนต์ ${arg}`);
  }
  if (bucket && !TARGET_BUCKETS.includes(bucket)) {
    throw new Error(
      `bucket ไม่ถูกต้อง: ${bucket} (ใช้ ${TARGET_BUCKETS.join(", ")})`,
    );
  }
  return { help: false, bucket };
}

function localObjectPath(baseDir, bucket, key) {
  const parts = String(key)
    .split("/")
    .filter((part) => part && part !== "." && part !== "..");
  return path.join(baseDir, "storage_mirror", bucket, ...parts);
}

function shouldSkip(localPath) {
  if (!fs.existsSync(localPath)) return false;
  return fs.statSync(localPath).size > 0;
}

async function listStorageTree(supabase, bucket, folder, depth = 0) {
  if (depth > 20) {
    throw new Error(`โฟลเดอร์ลึกเกินกำหนด: ${bucket}/${folder}`);
  }
  const files = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(folder, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) {
      throw new Error(`${bucket}/${folder || ""}: ${error.message}`);
    }
    const batch = data ?? [];
    for (const item of batch) {
      if (!item?.name || item.name === ".emptyFolderPlaceholder") continue;
      const key = folder ? `${folder}/${item.name}` : item.name;
      if (item.id == null) {
        files.push(...(await listStorageTree(supabase, bucket, key, depth + 1)));
        continue;
      }
      const size = Number(item.metadata?.size ?? 0);
      files.push({ key, size: Number.isFinite(size) ? size : 0 });
    }
    if (batch.length < limit) break;
    offset += limit;
  }

  return files;
}

async function backupBucketViaApi(supabase, baseDir, bucket) {
  console.log(`\n🗂️ [Storage API] ${bucket}`);
  const objects = await listStorageTree(supabase, bucket, "");
  if (objects.length === 0) {
    console.log(`   ℹ️ ไม่พบไฟล์ใน Bucket: ${bucket}`);
    return { downloaded: 0, skipped: 0, failed: 0 };
  }

  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  for (const item of objects) {
    const filePath = localObjectPath(baseDir, bucket, item.key);
    if (shouldSkip(filePath)) {
      skipped += 1;
      continue;
    }
    try {
      const { data, error } = await supabase.storage.from(bucket).download(item.key);
      if (error || !data) {
        throw new Error(error?.message || "download failed");
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      const buffer = Buffer.from(await data.arrayBuffer());
      fs.writeFileSync(filePath, buffer);
      downloaded += 1;
      console.log(
        `   ✅ [${bucket}] ${item.key} (${(buffer.length / 1024).toFixed(2)} KB)`,
      );
    } catch (error) {
      failed += 1;
      console.error(`   ❌ [${bucket}] ${item.key}: ${error.message}`);
    }
  }

  console.log(
    `🎉 [Storage API] ${bucket}: ดาวน์โหลด ${downloaded}, ข้าม ${skipped}, ล้มเหลว ${failed}`,
  );
  return { downloaded, skipped, failed };
}

async function backupBucketViaS3(s3, baseDir, bucket) {
  const { ListObjectsV2Command, GetObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );
  console.log(`\n🗂️ [S3] ${bucket}`);
  let continuationToken;
  let downloaded = 0;
  let skipped = 0;
  let failed = 0;
  let found = false;

  do {
    const page = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    );
    for (const item of page.Contents ?? []) {
      if (!item.Key || item.Key.endsWith("/")) continue;
      found = true;
      const remoteSize = Number(item.Size ?? 0);
      const filePath = localObjectPath(baseDir, bucket, item.Key);
      if (shouldSkip(filePath)) {
        skipped += 1;
        continue;
      }
      try {
        const { Body } = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: item.Key }),
        );
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        await pipeline(Body, fs.createWriteStream(filePath));
        downloaded += 1;
        console.log(
          `   ✅ [${bucket}] ${item.Key} (${(remoteSize / 1024).toFixed(2)} KB)`,
        );
      } catch (error) {
        failed += 1;
        console.error(`   ❌ [${bucket}] ${item.Key}: ${error.message}`);
      }
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);

  if (!found) console.log(`   ℹ️ ไม่พบไฟล์ใน Bucket: ${bucket}`);
  console.log(
    `🎉 [S3] ${bucket}: ดาวน์โหลด ${downloaded}, ข้าม ${skipped}, ล้มเหลว ${failed}`,
  );
  return { downloaded, skipped, failed };
}

async function runStorageBackup() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(
      `Usage: node scripts/backup/backup-storage.mjs [--bucket=${TARGET_BUCKETS.join("|")}]`,
    );
    return;
  }

  await ensureBackupEnv([]);

  const buckets = args.bucket ? [args.bucket] : TARGET_BUCKETS;
  const baseDir = await resolveBaseDir();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const s3Key = process.env.S3_ACCESS_KEY_ID?.trim();
  const totals = { downloaded: 0, skipped: 0, failed: 0 };

  console.log("🚀 [Storage Backup] Incremental mirror");
  console.log(`📍 ปลายทาง: ${path.join(baseDir, "storage_mirror")}`);

  const addTotals = (result) => {
    totals.downloaded += result.downloaded;
    totals.skipped += result.skipped;
    totals.failed += result.failed;
  };

  if (supabaseUrl && serviceRole) {
    const supabase = createClient(supabaseUrl, serviceRole, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    for (const bucket of buckets) {
      addTotals(await backupBucketViaApi(supabase, baseDir, bucket));
    }
  } else if (s3Key && process.env.S3_ENDPOINT && process.env.S3_SECRET_ACCESS_KEY) {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const s3 = new S3Client({
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    });
    for (const bucket of buckets) {
      addTotals(await backupBucketViaS3(s3, baseDir, bucket));
    }
  } else {
    console.error(
      "❌ ต้องมี NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY",
    );
    process.exit(1);
  }

  console.log(
    `\n✨ [System] downloaded=${totals.downloaded} skipped=${totals.skipped} failed=${totals.failed}`,
  );
  if (totals.failed > 0) process.exit(1);
}

runStorageBackup().catch((err) => {
  console.error("💥 [Storage Backup] fatal:", err.message || err);
  process.exit(1);
});
