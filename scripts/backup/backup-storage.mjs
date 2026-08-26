// scripts/backup/backup-storage.mjs
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const TARGET_BUCKETS = [
  "document_attachments",
  "production_attachments",
];


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


async function backupBucket(s3Client, baseBackupDir, bucketName) {
  console.log(
    `\n🗂️ [Storage Backup] เริ่มต้นดึงข้อมูลจาก Bucket: ${bucketName}...`,
  );

  try {
    let isTruncated = true;
    let continuationToken = undefined;
    let fileCount = 0;

    while (isTruncated) {
      const listCommand = new ListObjectsV2Command({
        Bucket: bucketName,
        ContinuationToken: continuationToken,
      });

      const { Contents, IsTruncated, NextContinuationToken } =
        await s3Client.send(listCommand);

      if (!Contents || Contents.length === 0) {
        console.log(`   ℹ️ ไม่พบไฟล์ใน Bucket: ${bucketName}`);
        break;
      }

      for (const item of Contents) {
        if (item.Key.endsWith("/")) continue;

        const filePath = path.join(baseBackupDir, bucketName, item.Key);
        const fileDir = path.dirname(filePath);

        if (!fs.existsSync(fileDir)) {
          fs.mkdirSync(fileDir, { recursive: true });
        }

        const getCommand = new GetObjectCommand({
          Bucket: bucketName,
          Key: item.Key,
        });

        const { Body } = await s3Client.send(getCommand);

        await pipeline(Body, fs.createWriteStream(filePath));

        console.log(
          `   ✅ โหลดสำเร็จ: [${bucketName}] ${item.Key} (${(item.Size / 1024).toFixed(2)} KB)`,
        );
        fileCount++;
      }

      isTruncated = IsTruncated;
      continuationToken = NextContinuationToken;
    }

    console.log(
      `🎉 [Storage Backup] สำเร็จ! รวม ${fileCount} ไฟล์ สำหรับ Bucket: ${bucketName}`,
    );
  } catch (error) {
    console.error(
      `❌ [Error] เกิดข้อผิดพลาดในการดึงข้อมูล Bucket: ${bucketName}`,
    );
    console.error("   👉 สาเหตุ:", error.message);
  }
}

async function runStorageBackup() {
  await ensureBackupEnv([
    "S3_ENDPOINT",
    "S3_REGION",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
  ]);

  const s3Client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  const date = new Date();
  const timestamp = date
    .toISOString()
    .replace(/[:.]/g, "-")
    .split("T")
    .join("_")
    .slice(0, 15);
  const baseBackupDir = path.resolve(
    __dirname,
    `../../backups/storage/backup_${timestamp}`,
  );

  console.log("🚀 [Storage Backup] เริ่มกระบวนการสำรองไฟล์ทั้งหมด...");
  console.log(`📍 ปลายทาง: ${baseBackupDir}`);

  for (const bucket of TARGET_BUCKETS) {
    await backupBucket(s3Client, baseBackupDir, bucket);
  }

  console.log("\n✨ [System] กระบวนการ Storage Backup เสร็จสมบูรณ์ทั้งหมด!");
}

runStorageBackup().catch((err) => {
  console.error("💥 [Storage Backup] fatal:", err.message || err);
  process.exit(1);
});
