// scripts/backup/backup-storage.mjs
import { S3Client, ListObjectsV2Command, GetObjectCommand } from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { pipeline } from "stream/promises";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { checkEnv } from "./load-env.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1. ตรวจสอบ Environment Variables ที่จำเป็นทั้งหมด
checkEnv(['S3_ENDPOINT', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']);

// 2. ตั้งค่าการเชื่อมต่อ S3 เข้ากับ Supabase Storage
const s3Client = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true, // [สำคัญมาก] บังคับให้ AWS SDK เข้ากันได้กับ Supabase
});

// 3. กำหนดรายชื่อ Buckets ที่ต้องการ Backup ตาม Business Logic
const TARGET_BUCKETS = [
    'document_attachments', // ไฟล์ WHT, สลิปโอนเงิน, รูปบิล OCR
    'production_attachments' // ไฟล์ภาพ Mockup งานสั่งทำ (Kanban)
];

// 4. สร้างโฟลเดอร์หลักสำหรับจัดเก็บ พร้อม Timestamp
const date = new Date();
const timestamp = date.toISOString().replace(/[:.]/g, '-').split('T').join('_').slice(0, 15);
const BASE_BACKUP_DIR = path.resolve(__dirname, `../../backups/storage/backup_${timestamp}`);

async function backupBucket(bucketName) {
    console.log(`\n🗂️ [Storage Backup] เริ่มต้นดึงข้อมูลจาก Bucket: ${bucketName}...`);
    
    try {
        let isTruncated = true;
        let continuationToken = undefined;
        let fileCount = 0;

        // วนลูปดึงรายชื่อไฟล์ (กรณีมีไฟล์จำนวนมาก ListObjects จะคืนค่ามาทีละ 1000 รายการ)
        while (isTruncated) {
            const listCommand = new ListObjectsV2Command({
                Bucket: bucketName,
                ContinuationToken: continuationToken,
            });

            const { Contents, IsTruncated, NextContinuationToken } = await s3Client.send(listCommand);

            if (!Contents || Contents.length === 0) {
                console.log(`   ℹ️ ไม่พบไฟล์ใน Bucket: ${bucketName}`);
                break;
            }

            // ดาวน์โหลดทีละไฟล์ด้วย Streaming
            for (const item of Contents) {
                // ข้าม Object ที่เป็นเพียง Folder (ลงท้ายด้วย /)
                if (item.Key.endsWith('/')) continue; 

                const filePath = path.join(BASE_BACKUP_DIR, bucketName, item.Key);
                const fileDir = path.dirname(filePath);

                // สร้างโฟลเดอร์ย่อยรองรับ (Recursive)
                if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                }

                // สั่งดึงไฟล์จาก S3
                const getCommand = new GetObjectCommand({
                    Bucket: bucketName,
                    Key: item.Key,
                });
                
                const { Body } = await s3Client.send(getCommand);
                
                // ต่อท่อ (Pipe) ข้อมูลลงไฟล์โดยตรงเพื่อประหยัด RAM
                await pipeline(Body, fs.createWriteStream(filePath));
                
                console.log(`   ✅ โหลดสำเร็จ: [${bucketName}] ${item.Key} (${(item.Size / 1024).toFixed(2)} KB)`);
                fileCount++;
            }

            isTruncated = IsTruncated;
            continuationToken = NextContinuationToken;
        }

        console.log(`🎉 [Storage Backup] สำเร็จ! รวม ${fileCount} ไฟล์ สำหรับ Bucket: ${bucketName}`);

    } catch (error) {
        console.error(`❌ [Error] เกิดข้อผิดพลาดในการดึงข้อมูล Bucket: ${bucketName}`);
        console.error(`   👉 สาเหตุ:`, error.message);
    }
}

async function runStorageBackup() {
    console.log(`🚀 [Storage Backup] เริ่มกระบวนการสำรองไฟล์ทั้งหมด...`);
    console.log(`📍 ปลายทาง: ${BASE_BACKUP_DIR}`);

    // รันการสำรองข้อมูลทีละ Bucket
    for (const bucket of TARGET_BUCKETS) {
        await backupBucket(bucket);
    }

    console.log(`\n✨ [System] กระบวนการ Storage Backup เสร็จสมบูรณ์ทั้งหมด!`);
}

runStorageBackup();