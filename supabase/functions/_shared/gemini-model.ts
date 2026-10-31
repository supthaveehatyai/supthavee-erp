/**
 * Gemini model resolver for OCR Edge Functions.
 * Keep in sync with `lib/ai/gemini-client.ts`.
 * Reads system_parameters.GEMINI_MODEL_VERSION, then Google's live model list on 404.
 */

export const GEMINI_MODEL_PARAM_KEY = "GEMINI_MODEL_VERSION";

const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

type ModelOption = { id: string; displayName: string };

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type SystemParametersClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: string,
      ) => {
        single: () => Promise<{
          data: { param_value: unknown } | null;
          error: { message?: string } | null;
        }>;
      };
    };
  };
};

export function cleanGeminiModelId(raw: unknown): string {
  if (raw == null) return "";
  const rawVal = typeof raw === "string" ? raw : JSON.stringify(raw);
  return String(rawVal)
    .replace(/^"|"$/g, "")
    .replace(/^models\//, "")
    .trim();
}

function versionScore(modelId: string): number {
  const match = modelId.match(/(\d+(?:\.\d+)+)/);
  if (!match) return 0;
  return match[1]
    .split(".")
    .reduce((total, part) => total * 1000 + (Number(part) || 0), 0);
}

async function readGoogleError(
  response: Response,
): Promise<{ status: number; message: string }> {
  let message = response.statusText || "Gemini request failed";
  try {
    const body = (await response.json()) as {
      error?: { message?: string };
    };
    if (body?.error?.message) message = body.error.message;
  } catch {
    // non-JSON
  }
  return { status: response.status, message };
}

export async function listGeminiModelCatalog(
  apiKey: string,
): Promise<ModelOption[]> {
  const response = await fetch(
    `${MODELS_URL}?key=${encodeURIComponent(apiKey)}&pageSize=100`,
  );
  if (!response.ok) {
    const error = await readGoogleError(response);
    throw new Error(
      `ดึงรายชื่อโมเดลจาก Google ไม่สำเร็จ (${error.status}): ${error.message}`,
    );
  }
  const body = (await response.json()) as {
    models?: Array<{
      name?: string;
      displayName?: string;
      supportedGenerationMethods?: string[];
    }>;
  };
  const models: ModelOption[] = [];
  for (const row of body.models ?? []) {
    const id = cleanGeminiModelId(row.name ?? "");
    const methods = row.supportedGenerationMethods ?? [];
    if (!id.includes("gemini") || !methods.includes("generateContent")) continue;
    models.push({
      id,
      displayName: row.displayName?.trim() || id,
    });
  }
  const flash = models.filter((model) => model.id.includes("flash"));
  const rest = models.filter((model) => !model.id.includes("flash"));
  const byVersion = (a: ModelOption, b: ModelOption) =>
    versionScore(b.id) - versionScore(a.id);
  return [...flash.sort(byVersion), ...rest.sort(byVersion)];
}

async function generateWithModel(
  apiKey: string,
  modelName: string,
  parts: GeminiPart[],
): Promise<string> {
  const url = `${MODELS_URL}/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: parts.map((part) =>
            "text" in part
              ? { text: part.text }
              : {
                  inline_data: {
                    mime_type: part.inlineData.mimeType,
                    data: part.inlineData.data,
                  },
                },
          ),
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    }),
  });

  if (response.ok) {
    const body = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    const text = (body.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!text) {
      throw Object.assign(new Error("Gemini returned empty response"), {
        status: 502,
      });
    }
    return text;
  }

  const error = await readGoogleError(response);
  const quota =
    error.status === 429 ||
    /quota exceeded|resource_exhausted|free_tier_requests/i.test(error.message);
  throw Object.assign(new Error(error.message), {
    status: quota ? 429 : error.status,
  });
}

function errorStatus(error: unknown): number | undefined {
  if (error && typeof error === "object" && "status" in error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") return status;
  }
  return undefined;
}

export async function loadGeminiModelVersion(
  supabase: SystemParametersClient,
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("system_parameters")
      .select("param_value")
      .eq("param_key", GEMINI_MODEL_PARAM_KEY)
      .single();

    if (error || data?.param_value == null) {
      console.warn(
        "[gemini-model] GEMINI_MODEL_VERSION missing:",
        error?.message ?? "no row",
      );
      return "";
    }

    return cleanGeminiModelId(data.param_value);
  } catch (error) {
    console.warn("[gemini-model] query failed:", error);
    return "";
  }
}

const OCR_MODEL_CASCADE = [
  "gemini-3.0-flash",
  "gemini-2.5-flash",
  "gemini-1.5-flash",
];

const RETIRED_OCR_MODELS = new Set(["gemini-2.0-flash"]);

const OCR_QUOTA_EXHAUSTED_MESSAGE =
  "โควตาฟรีรายวันครบกำหนดแล้ว (รีเซ็ตเวลา 14:00 น.) สามารถตรวจสอบโควตาหรือเปิด Billing ได้ที่ ai.dev/rate-limit";

function isCascadeFallback(status: number | undefined, message: string): boolean {
  return (
    status === 429 ||
    status === 404 ||
    status === 503 ||
    /quota exceeded|resource_exhausted|free_tier_requests|no longer available|not found|service unavailable/i.test(
      message,
    )
  );
}

function cleanCascadeId(model: string): string {
  return model.replace(/^models\//, "").trim();
}

export function modelsAtQuotaFromPayload(data: unknown): string[] {
  const root = Array.isArray(data) ? data[0] : data;
  if (!root || typeof root !== "object") return [];
  const record = root as {
    models_usage?: Record<string, unknown>;
    models_limits?: Record<string, unknown>;
    data?: { models_usage?: Record<string, unknown>; models_limits?: Record<string, unknown> };
  };
  const source = record.models_usage || record.models_limits ? record : record.data;
  if (!source?.models_usage) return [];
  const limits = source.models_limits ?? {};
  return Object.entries(source.models_usage).flatMap(([model, used]) => {
    const id = cleanCascadeId(model);
    const limit = Number(limits[model] ?? limits[id]);
    const count = Number(used);
    if (!id || !Number.isFinite(count) || !Number.isFinite(limit)) return [];
    return count >= limit ? [id] : [];
  });
}

export function parseEdgeModelCascade(value: unknown): string[] | null {
  let raw = value;
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^"|"$/g, "");
    if (!trimmed) return null;
    try {
      raw = trimmed.startsWith("[") ? JSON.parse(trimmed) : trimmed.split(",");
    } catch {
      return null;
    }
  }
  if (!Array.isArray(raw)) return null;
  const ids = raw
    .map((item) => cleanCascadeId(String(item ?? "")))
    .filter((id) => id && !RETIRED_OCR_MODELS.has(id));
  return ids.length > 0 ? [...new Set(ids)] : null;
}

function ocrCascade(preferred: string, configured?: string[] | null): string[] {
  const source = (configured && configured.length > 0 ? configured : OCR_MODEL_CASCADE)
    .map(cleanCascadeId)
    .filter((id) => id && !RETIRED_OCR_MODELS.has(id));
  const base = [...new Set(source.length > 0 ? source : OCR_MODEL_CASCADE)];
  const cleanedPreferred = cleanCascadeId(preferred);
  if (
    !cleanedPreferred ||
    RETIRED_OCR_MODELS.has(cleanedPreferred) ||
    !base.includes(cleanedPreferred)
  ) {
    return base;
  }
  return [cleanedPreferred, ...base.filter((id) => id !== cleanedPreferred)];
}

export async function generateGeminiContent(options: {
  apiKey: string;
  preferredModel: string;
  parts: GeminiPart[];
  modelCascade?: string[] | null;
  skipModels?: string[] | null;
  onModelOutcome?: (outcome: { model: string; exhausted: boolean }) => Promise<void>;
}): Promise<{ text: string; modelUsed: string; notice: string | null }> {
  const preferred = cleanGeminiModelId(options.preferredModel);
  const cascade = ocrCascade(preferred, options.modelCascade);
  const skipped = new Set((options.skipModels ?? []).map(cleanCascadeId));
  let fallbackFailures = 0;
  let attempted = 0;
  let lastError: unknown = null;

  for (const modelName of cascade) {
    if (skipped.has(modelName)) {
      console.warn(`[gemini-model] skip ${modelName} — quota already full`);
      fallbackFailures += 1;
      continue;
    }
    attempted += 1;
    try {
      const text = await generateWithModel(options.apiKey, modelName, options.parts);
      await options.onModelOutcome?.({ model: modelName, exhausted: false });
      const notice =
        modelName !== cascade[0]
          ? `โมเดลก่อนหน้าใช้ไม่ได้ ระบบใช้ ${modelName} แทน`
          : null;
      console.log(`[gemini-model] using ${modelName}`);
      return { text, modelUsed: modelName, notice };
    } catch (error) {
      lastError = error;
      const status = errorStatus(error);
      const message = error instanceof Error ? error.message : "";
      if (isCascadeFallback(status, message)) fallbackFailures += 1;
      console.warn(`[gemini-model] ${modelName} failed (${status ?? "unknown"}) — next model`);
      if (isCascadeFallback(status, message)) {
        await options.onModelOutcome?.({ model: modelName, exhausted: true });
      }
      continue;
    }
  }

  if (attempted === 0 || fallbackFailures > 0) {
    throw new Error(OCR_QUOTA_EXHAUSTED_MESSAGE);
  }
  const detail = lastError instanceof Error ? lastError.message : "ไม่ทราบสาเหตุ";
  throw new Error(`เรียก Gemini ไม่สำเร็จ: ${detail}`);
}
