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

async function listFlashCandidates(apiKey: string): Promise<string[]> {
  const catalog = await listGeminiModelCatalog(apiKey);
  const flash = catalog.filter((model) => model.id.includes("flash"));
  const pool = flash.length > 0 ? flash : catalog;
  return pool.map((model) => model.id);
}

async function generateWithModel(
  apiKey: string,
  modelName: string,
  parts: GeminiPart[],
): Promise<string> {
  const url = `${MODELS_URL}/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  let lastMessage = "Gemini request failed";

  for (let attempt = 1; attempt <= 3; attempt += 1) {
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
    lastMessage = error.message;
    if ((error.status === 503 || error.status === 429) && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
      continue;
    }
    throw Object.assign(new Error(error.message), { status: error.status });
  }

  throw Object.assign(new Error(lastMessage), { status: 503 });
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

export async function generateGeminiContent(options: {
  apiKey: string;
  preferredModel: string;
  parts: GeminiPart[];
}): Promise<{ text: string; modelUsed: string; notice: string | null }> {
  const preferred = cleanGeminiModelId(options.preferredModel);

  if (preferred) {
    try {
      const text = await generateWithModel(
        options.apiKey,
        preferred,
        options.parts,
      );
      console.log(`[gemini-model] using ${preferred}`);
      return { text, modelUsed: preferred, notice: null };
    } catch (error) {
      if (errorStatus(error) !== 404) throw error;
      console.warn(
        `[gemini-model] ${preferred} returned 404. Discovering a live flash model...`,
      );
    }
  }

  const candidates = (await listFlashCandidates(options.apiKey)).filter(
    (id) => id !== preferred,
  );
  if (candidates.length === 0) {
    throw new Error(
      preferred
        ? `โมเดล ${preferred} ใช้ไม่ได้ และ Google API ไม่มีโมเดล gemini ที่รองรับ generateContent`
        : "ไม่พบโมเดล gemini ที่รองรับ generateContent จาก Google API",
    );
  }

  let lastError: unknown = null;
  for (const modelName of candidates.slice(0, 3)) {
    try {
      const text = await generateWithModel(
        options.apiKey,
        modelName,
        options.parts,
      );
      const notice = preferred
        ? `โมเดลที่ตั้งไว้ (${preferred}) ใช้ไม่ได้ ระบบใช้ ${modelName} จาก Google API แทน`
        : `ระบบใช้ ${modelName} จาก Google API`;
      console.warn(`[gemini-model] ${notice}`);
      return { text, modelUsed: modelName, notice };
    } catch (error) {
      lastError = error;
      if (errorStatus(error) === 404) continue;
      throw error;
    }
  }

  const detail = lastError instanceof Error ? lastError.message : "ไม่ทราบสาเหตุ";
  throw new Error(`เรียก Gemini ไม่สำเร็จ: ${detail}`);
}
