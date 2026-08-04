// scripts/backup/backup-db.mjs
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import zlib from 'zlib'; // ใช้ Native Node.js library แทน OS gzip
import { checkEnv } from './load-env.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 1. ตรวจสอบ Environment
checkEnv(['DATABASE_URL']);

// 2. สร้างโฟลเดอร์ปลายทาง
const BACKUP_DIR = path.resolve(__dirname, '../../backups/db');
if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    console.log(`📁 [System] Created backup directory at: ${BACKUP_DIR}`);
}

// 3. กำหนดชื่อไฟล์
const date = new Date();
const timestamp = date.toISOString().replace(/[:.]/g, '-').split('T').join('_').slice(0, 15);
const filename = `supthavee_erp_db_backup_${timestamp}.sql.gz`;
const filepath = path.join(BACKUP_DIR, filename);

async function runDatabaseBackup() {
    console.log(`📦 [Database Backup] Starting backup process using Node.js Streams...`);
    console.log(`⏳ Please wait, this might take a moment depending on database size.`);

    const dbUrl = process.env.DATABASE_URL;

    // 4. แยก Arguments เพื่อความปลอดภัย (ลดปัญหา String Escaping)
    const args = [
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        dbUrl
    ];

    // 5. สถาปัตยกรรม Streaming (ประหยัด RAM / ไม่พึ่งพา OS gzip)
    const dumpProcess = spawn('pg_dump', args);
    const gzipStream = zlib.createGzip();
    const fileWriteStream = fs.createWriteStream(filepath);

    // ต่อท่อส่งข้อมูล: Database -> บีบอัด Gzip -> เขียนลงไฟล์
    dumpProcess.stdout.pipe(gzipStream).pipe(fileWriteStream);

    dumpProcess.stderr.on('data', (data) => {
        const msg = data.toString();
        // ข้ามข้อความ Warning ทั่วไปของ pg_dump
        if (!msg.toLowerCase().includes('warning')) {
            console.log(`ℹ️ [pg_dump log]: ${msg.trim()}`);
        }
    });

    dumpProcess.on('close', (code) => {
        if (code === 0) {
            const stats = fs.statSync(filepath);
            const fileSizeInMB = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(`✅ [Database Backup] Success!`);
            console.log(`📄 File: ${filename}`);
            console.log(`💾 Size: ${fileSizeInMB} MB`);
            console.log(`📍 Location: ${filepath}`);
        } else {
            console.error(`❌ [Database Backup] Failed with exit code ${code}`);
            process.exit(1);
        }
    });

    dumpProcess.on('error', (err) => {
        console.error(`❌ [Error] Failed to start pg_dump. Reason:`, err.message);
        process.exit(1);
    });
}

runDatabaseBackup();