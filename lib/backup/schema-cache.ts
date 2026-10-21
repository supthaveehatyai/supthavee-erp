/**
 * ตารางที่ PostgREST / Postgres มองไม่เห็น ไม่ควรทำให้ทั้งไฟล์สำรองล้ม
 */

const MISSING_TABLE_MESSAGE =
  /Could not find the table|schema cache|does not exist/i;

export function isMissingSchemaTableError(error: {
  message?: string;
  code?: string;
} | null): boolean {
  if (!error) return false;
  if (error.code === "PGRST205" || error.code === "42P01") return true;
  return MISSING_TABLE_MESSAGE.test(error.message ?? "");
}
