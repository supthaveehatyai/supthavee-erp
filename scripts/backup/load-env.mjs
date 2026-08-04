// scripts/backup/load-env.mjs
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// โหลด .env.production จาก Root Directory ของโปรเจกต์
const envPath = resolve(__dirname, "../../.env.production");
dotenv.config({ path: envPath });

/**
 * Utility Function ตรวจสอบว่ามีตัวแปร Environment ครบถ้วนหรือไม่ก่อนรันสคริปต์
 * @param {string[]} keys - Array ของชื่อตัวแปรที่ต้องการตรวจสอบ
 */
export const checkEnv = (keys) => {
  const missing = keys.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    console.error(
      `❌ [Error] Missing required environment variables in .env.production:`,
    );
    console.error(`   👉 ${missing.join(", ")}`);
    console.error(`   กรุณาตรวจสอบไฟล์ .env.production ของคุณ`);
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

export default checkEnv;
