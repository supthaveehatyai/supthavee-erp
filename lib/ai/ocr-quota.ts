/** Gemini 3.x order used when `system_parameters.model_cascade_order` is empty. */
export const OCR_MODEL_CASCADE = [
  "gemini-3.8-flash",
  "gemini-3.7-flash",
  "gemini-3.5-flash",
  "gemini-3.5-flash-lite",
  "gemini-3-flash",
  "gemini-3.1-flash-lite",
] as const;

const RETIRED_OCR_MODELS = new Set(["gemini-2.0-flash"]);

export const OCR_QUOTA_DAILY_LIMIT = 20;

export const OCR_QUOTA_RESET_NOTE = "รีเซ็ตโควตารายวัน 14:00 น.";

export const OCR_QUOTA_EXHAUSTED_MESSAGE =
  "โควตาฟรีรายวันครบกำหนดแล้ว (รีเซ็ตเวลา 14:00 น.) สามารถตรวจสอบโควตาหรือเปิด Billing ได้ที่ ai.dev/rate-limit";

export type OcrQuotaModelStatus = {
  model: string;
  label: string;
  used: number | null;
  limit: number | null;
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

/** 429, retired model 404, or a short Gemini outage — move to the next id. */
export function isGeminiCascadeFallbackError(
  status: number | undefined,
  message: string,
): boolean {
  if (status === 429 || status === 404 || status === 503) return true;
  return /quota exceeded|resource_exhausted|free_tier_requests|no longer available|not found|service unavailable/i.test(
    message,
  );
}

export function cleanOcrModelId(model: string): string {
  return model.replace(/^models\//, "").trim();
}

export function parseModelCascadeOrder(value: unknown): string[] | null {
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^"|"$/g, "");
    if (!trimmed) return null;
    if (trimmed.startsWith("[")) {
      try {
        raw = JSON.parse(trimmed) as unknown;
      } catch {
        return null;
      }
    } else {
      raw = trimmed.split(",");
    }
  }
  if (!Array.isArray(raw)) return null;
  const ids = raw
    .map((item) => cleanOcrModelId(String(item ?? "")))
    .filter((id) => id && !RETIRED_OCR_MODELS.has(id));
  return ids.length > 0 ? [...new Set(ids)] : null;
}

export function buildOcrModelCascade(
  preferredModel: string,
  configured?: string[] | null,
): string[] {
  const source = (configured && configured.length > 0
    ? configured
    : [...OCR_MODEL_CASCADE]
  )
    .map(cleanOcrModelId)
    .filter((id) => id && !RETIRED_OCR_MODELS.has(id));
  const unique = [...new Set(source)];
  const base = unique.length > 0 ? unique : [...OCR_MODEL_CASCADE];
  const preferred = cleanOcrModelId(preferredModel);
  if (!preferred || RETIRED_OCR_MODELS.has(preferred) || !base.includes(preferred)) {
    return base;
  }
  return [preferred, ...base.filter((id) => id !== preferred)];
}

export function ocrModelLabel(model: string): string {
  const lite = /gemini-(\d+(?:\.\d+)?)-flash-lite/i.exec(model.trim());
  if (lite) return `${lite[1]}-Flash-Lite`;
  const flash = /gemini-(\d+(?:\.\d+)?)-flash/i.exec(model.trim());
  if (flash) return `${flash[1]}-Flash`;
  return model.replace(/^models\//, "").replace(/^gemini-/i, "") || model;
}

export function formatOcrQuotaChip(model: OcrQuotaModelStatus): string {
  if (model.used == null || model.limit == null) {
    return `${model.label}: ไม่ทราบโควตา`;
  }
  const full = model.exhausted || model.used >= model.limit;
  return `${model.label}: ${model.used}/${model.limit} (${full ? "เต็ม" : "พร้อมใช้งาน"})`;
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

function unwrapQuota(data: unknown): Record<string, unknown> | null {
  if (Array.isArray(data)) return unwrapQuota(data[0]);
  if (!isRecord(data)) return null;
  if (isRecord(data.data) && ("models_usage" in data.data || "models_limits" in data.data)) {
    return data.data;
  }
  return data;
}

function readCountMap(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const counts: Record<string, number> = {};
  for (const [key, raw] of Object.entries(value)) {
    const model = cleanOcrModelId(key);
    const count = readNumber(raw);
    if (!model || count == null) continue;
    counts[model] = count;
  }
  return counts;
}

export function readOcrQuotaMaps(data: unknown): {
  usage: Record<string, number>;
  limits: Record<string, number>;
} {
  const root = unwrapQuota(data);
  return {
    usage: readCountMap(root?.models_usage),
    limits: readCountMap(root?.models_limits),
  };
}

/** Models whose stored usage is already at or above the stored limit. */
export function modelsAtQuota(data: unknown): string[] {
  const { usage, limits } = readOcrQuotaMaps(data);
  return Object.keys(usage).filter((model) => {
    const limit = limits[model];
    return limit != null && usage[model] >= limit;
  });
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
    limit: null,
    exhausted: false,
  }));
}

export function normalizeOcrQuotaPayload(data: unknown): OcrQuotaModelStatus[] {
  const { usage, limits } = readOcrQuotaMaps(data);
  if (Object.keys(usage).length > 0 || Object.keys(limits).length > 0) {
    const ids = [
      ...OCR_MODEL_CASCADE.filter((model) => model in usage || model in limits),
      ...Object.keys(usage),
      ...Object.keys(limits),
    ];
    const orderedIds = [...new Set(ids.map(cleanOcrModelId))].filter(
      (model) => model && !RETIRED_OCR_MODELS.has(model),
    );
    return orderedIds.map((model) => {
      const limit = limits[model] ?? null;
      const used = model in usage ? usage[model] : limit != null ? 0 : null;
      return {
        model,
        label: ocrModelLabel(model),
        used,
        limit,
        exhausted: used != null && limit != null && used >= limit,
      };
    });
  }

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
