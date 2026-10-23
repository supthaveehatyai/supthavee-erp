/** Free-tier OCR model order. Daily quota does not carry across model ids. */
export const OCR_MODEL_CASCADE = [
  "gemini-3.8-flash",
  "gemini-2.5-flash",
  "gemini-2.0-flash",
] as const;

export const OCR_QUOTA_DAILY_LIMIT = 20;

export const OCR_QUOTA_RESET_NOTE = "รีเซ็ตโควตารายวัน 14:00 น.";

export const OCR_QUOTA_EXHAUSTED_MESSAGE =
  "โควตาฟรีรายวันครบกำหนดแล้ว (รีเซ็ตเวลา 14:00 น.) สามารถตรวจสอบโควตาหรือเปิด Billing ได้ที่ ai.dev/rate-limit";

export type OcrQuotaModelStatus = {
  model: string;
  label: string;
  used: number | null;
  limit: number;
  exhausted: boolean;
};

export type OcrQuotaStatus = {
  models: OcrQuotaModelStatus[];
  resetNote: string;
  error: string | null;
};

export function isGeminiQuotaError(
  status: number | undefined,
  message: string,
): boolean {
  if (status === 429) return true;
  return /quota exceeded|resource_exhausted|free_tier_requests/i.test(message);
}

export function buildOcrModelCascade(preferredModel: string): string[] {
  const ordered = [preferredModel, ...OCR_MODEL_CASCADE]
    .map((model) => model.trim())
    .filter(Boolean);
  return [...new Set(ordered)];
}

export function ocrModelLabel(model: string): string {
  const match = /gemini-(\d+(?:\.\d+)?)-flash/i.exec(model.trim());
  if (match) return `${match[1]}-Flash`;
  return model.replace(/^models\//, "").replace(/^gemini-/i, "") || model;
}

export function formatOcrQuotaChip(model: OcrQuotaModelStatus): string {
  const full =
    model.exhausted ||
    (model.used != null && model.limit > 0 && model.used >= model.limit);
  if (full) {
    const used = model.used ?? model.limit;
    return `${model.label}: ${used}/${model.limit} (เต็ม)`;
  }
  return `${model.label}: พร้อมใช้งาน`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function quotaRows(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data.filter(isRecord);
  if (!isRecord(data)) return [];
  for (const key of ["models", "quotas", "rows", "data"]) {
    if (Array.isArray(data[key])) return data[key].filter(isRecord);
  }
  if (data.model || data.model_used || data.p_model_used) return [data];
  return [];
}

export function defaultOcrQuotaModels(): OcrQuotaModelStatus[] {
  return OCR_MODEL_CASCADE.map((model) => ({
    model,
    label: ocrModelLabel(model),
    used: null,
    limit: OCR_QUOTA_DAILY_LIMIT,
    exhausted: false,
  }));
}

export function normalizeOcrQuotaPayload(data: unknown): OcrQuotaModelStatus[] {
  const rows = quotaRows(data);
  if (rows.length === 0) return defaultOcrQuotaModels();

  const parsed = rows.flatMap((row) => {
    const model = String(
      row.model ?? row.model_used ?? row.p_model_used ?? "",
    ).trim();
    if (!model) return [];
    const used = readNumber(row.used ?? row.used_today ?? row.request_count ?? row.scans);
    const limit = readNumber(row.limit ?? row.daily_limit ?? row.quota_limit) ?? OCR_QUOTA_DAILY_LIMIT;
    const exhaustedFlag = row.exhausted ?? row.is_exhausted ?? row.p_is_exhausted;
    const exhausted =
      exhaustedFlag === true ||
      exhaustedFlag === "true" ||
      (used != null && limit > 0 && used >= limit);
    return [
      {
        model,
        label: ocrModelLabel(model),
        used,
        limit,
        exhausted,
      },
    ];
  });

  if (parsed.length === 0) return defaultOcrQuotaModels();

  const byModel = new Map(parsed.map((row) => [row.model, row]));
  const ordered = OCR_MODEL_CASCADE.map(
    (model) =>
      byModel.get(model) ?? {
        model,
        label: ocrModelLabel(model),
        used: null,
        limit: OCR_QUOTA_DAILY_LIMIT,
        exhausted: false,
      },
  );
  for (const row of parsed) {
    if (!ordered.some((item) => item.model === row.model)) ordered.push(row);
  }
  return ordered;
}
