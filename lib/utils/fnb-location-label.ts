export function locationShortLabel(code: string, name: string, stored?: string | null): string {
  const saved = (stored || "").trim();
  if (saved) return saved;
  const blob = `${code} ${name}`.toLowerCase();
  if (blob.includes("โกดัง") || blob.includes("warehouse") || blob.includes("wh")) return "โกดัง";
  if (blob.includes("ชั้น2") || blob.includes("ชั้น 2") || blob.includes("shelf")) return "ชั้น2";
  if (blob.includes("หลัง") || blob.includes("back")) return "ด้านหลัง";
  if (blob.includes("หน้า") || blob.includes("โชว์") || blob.includes("front") || blob.includes("display")) return "ตู้หน้า";
  const compact = name.trim();
  return compact.length > 8 ? compact.slice(0, 8) : compact || code;
}
