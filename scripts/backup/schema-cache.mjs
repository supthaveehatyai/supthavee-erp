/**
 * ใช้ร่วมกับ backup-db.mjs และ json-engine.mjs
 * ตรงกับ lib/backup/schema-cache.ts
 */
const MISSING_TABLE_MESSAGE =
  /Could not find the table|schema cache|does not exist/i;

export function isMissingSchemaTableError(error) {
  if (!error) return false;
  const code = String(error.code ?? "");
  if (code === "PGRST205" || code === "42P01") return true;
  return MISSING_TABLE_MESSAGE.test(String(error.message ?? ""));
}
