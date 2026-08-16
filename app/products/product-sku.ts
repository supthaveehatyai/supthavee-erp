export type Gender = {
  id: string;
  gender_code: string;
  gender_name: string;
};

export const MODEL_CODE_LENGTH = 6;
/** Fixed-3 Character Color Standard — last segment before size in SKU. */
export const COLOR_CODE_LENGTH = 3;
/**
 * Fixed-2 Character Size Code — trailing SKU segment.
 * Blueprint: Brand + Category(2) + Model(6) + Gender(1) + Color(3) + Size(2).
 */
export const SIZE_CODE_LENGTH = 2;
export const SIZE_CODE_SKU_REGEX = /^[A-Z0-9]{2}$/;

export function normalizeSkuPart(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9ก-๙-]/g, "");
}

/**
 * Normalize size token for SKU assembly.
 * - Strip non A–Z/0–9
 * - Zero-pad single-character legacy codes (`S` → `0S`) for Fixed-2 stability
 * - Cap at 2 chars (never emit a longer size segment)
 */
export function normalizeSizeCodeForSku(value: string): string {
  const normalized = normalizeSkuPart(value).replace(/[^A-Z0-9]/g, "");
  if (normalized.length === 0) return "";
  if (normalized.length === 1) {
    return normalized.padStart(SIZE_CODE_LENGTH, "0");
  }
  return normalized.slice(0, SIZE_CODE_LENGTH);
}

export function isValidSizeCodeForSku(value: string): boolean {
  return SIZE_CODE_SKU_REGEX.test(normalizeSizeCodeForSku(value));
}

export function isValidModelCode(value: string): boolean {
  return value.trim().length === MODEL_CODE_LENGTH;
}

/**
 * SKU = Brand + Category(2) + Model(6) + Gender(1) + Color(3) + Size(2).
 * Size segment always resolves to Fixed-2 (with zero-pad for 1-char legacy).
 */
export function buildProductSku(parts: {
  brandCode: string;
  categoryCode: string;
  modelCode: string;
  genderCode: string;
  colorCode: string;
  sizeCode: string;
}): string {
  const colorCode = normalizeSkuPart(parts.colorCode)
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, COLOR_CODE_LENGTH);
  const sizeCode = normalizeSizeCodeForSku(parts.sizeCode);

  return [
    normalizeSkuPart(parts.brandCode),
    normalizeSkuPart(parts.categoryCode),
    normalizeSkuPart(parts.modelCode),
    normalizeSkuPart(parts.genderCode),
    colorCode,
    sizeCode,
  ].join("");
}

/** Prefer first Latin letter; otherwise first normalized character. */
export function makeGenderCodeFromName(name: string): string {
  const latin = name.match(/[A-Za-z]/);
  if (latin) return latin[0].toUpperCase();
  const normalized = normalizeSkuPart(name);
  return (normalized.charAt(0) || "G").toUpperCase();
}

export function formatGenderOption(gender: Gender): string {
  return `${gender.gender_name} (${gender.gender_code})`;
}
