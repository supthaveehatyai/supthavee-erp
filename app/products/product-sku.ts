export type Gender = {
  id: string;
  gender_code: string;
  gender_name: string;
};

export const MODEL_CODE_LENGTH = 6;

export function normalizeSkuPart(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^A-Z0-9ก-๙-]/g, "");
}

export function isValidModelCode(value: string): boolean {
  return value.trim().length === MODEL_CODE_LENGTH;
}

export function buildProductSku(parts: {
  brandCode: string;
  categoryCode: string;
  modelCode: string;
  genderCode: string;
  colorCode: string;
  sizeCode: string;
}): string {
  return [
    parts.brandCode,
    parts.categoryCode,
    parts.modelCode,
    parts.genderCode,
    parts.colorCode,
    parts.sizeCode,
  ]
    .map(normalizeSkuPart)
    .join("");
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
