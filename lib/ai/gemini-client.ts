/**
 * Gemini REST client (Node + Edge-safe fetch).
 * Model id comes from system_parameters, then Google's live model list on 404.
 */

export type GeminiModelOption = {
  id: string;
  displayName: string;
};

export type GeminiGenerateResult = {
  text: string;
  modelUsed: string;
  fellBack: boolean;
  notice: string | null;
};

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } };

type GoogleModelRow = {
  name?: string;
  displayName?: string;
  supportedGenerationMethods?: string[];
};

const MODELS_URL = "https://generativelanguage.googleapis.com/v1beta/models";

export const GEMINI_API_KEY_MISSING_MESSAGE =
  "ไม่พบ GEMINI_API_KEY ทั้งบน Vercel (Environment Variables) และ Supabase Secrets";

/** Server-side key. Checks Vercel / Next env names, including a public alias. */
export function resolveGeminiApiKey(): string {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GEMINI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.NEXT_PUBLIC_GEMINI_API_KEY ||
    ""
  ).trim();
}

/** jsonb / quoted / `models/` prefix → bare model id. */
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

function stabilityScore(modelId: string): number {
  let score = 0;
  if (modelId.includes("flash") && !modelId.includes("flash-lite")) score += 50;
  if (modelId.includes("flash-lite")) score += 10;
  if (modelId.includes("-exp") || modelId.includes("preview")) score -= 20;
  if (modelId.endsWith("-latest")) score += 5;
  return score;
}

/** Flash-family ids, newest version first. */
export function rankFlashModelIds(models: GeminiModelOption[]): string[] {
  const flash = models.filter(
    (model) =>
      model.id.includes("gemini") && model.id.includes("flash"),
  );
  const pool = flash.length > 0 ? flash : models;
  return [...pool]
    .sort((a, b) => {
      const versionDelta = versionScore(b.id) - versionScore(a.id);
      if (versionDelta !== 0) return versionDelta;
      return stabilityScore(b.id) - stabilityScore(a.id);
    })
    .map((model) => model.id);
}

export function orderGeminiModels(
  models: GeminiModelOption[],
): GeminiModelOption[] {
  const ranked = rankFlashModelIds(models);
  const byId = new Map(models.map((model) => [model.id, model]));
  const ordered: GeminiModelOption[] = [];
  for (const id of ranked) {
    const model = byId.get(id);
    if (model) ordered.push(model);
  }
  const seen = new Set(ordered.map((model) => model.id));
  const rest = models
    .filter((model) => !seen.has(model.id))
    .sort((a, b) => a.id.localeCompare(b.id));
  return [...ordered, ...rest];
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
    // non-JSON error page
  }
  return { status: response.status, message };
}

export async function listGeminiGenerateModels(
  apiKey: string,
): Promise<GeminiModelOption[]> {
  const collected: GeminiModelOption[] = [];
  let pageToken = "";

  for (let page = 0; page < 5; page += 1) {
    const url = new URL(MODELS_URL);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("pageSize", "100");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const response = await fetch(url);
    if (!response.ok) {
      const error = await readGoogleError(response);
      throw new Error(
        `ดึงรายชื่อโมเดลจาก Google ไม่สำเร็จ (${error.status}): ${error.message}`,
      );
    }

    const body = (await response.json()) as {
      models?: GoogleModelRow[];
      nextPageToken?: string;
    };

    for (const row of body.models ?? []) {
      const methods = row.supportedGenerationMethods ?? [];
      const id = cleanGeminiModelId(row.name ?? "");
      if (!id.includes("gemini")) continue;
      if (!methods.includes("generateContent")) continue;
      collected.push({
        id,
        displayName: row.displayName?.trim() || id,
      });
    }

    pageToken = body.nextPageToken ?? "";
    if (!pageToken) break;
  }

  return orderGeminiModels(collected);
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

/**
 * 1) Preferred model from system_parameters.
 * 2) On 404 (or empty preferred), pick the newest flash model from Google's list.
 */
export async function generateGeminiContent(options: {
  apiKey: string;
  preferredModel: string;
  parts: GeminiPart[];
}): Promise<GeminiGenerateResult> {
  const preferred = cleanGeminiModelId(options.preferredModel);

  if (preferred) {
    try {
      const text = await generateWithModel(
        options.apiKey,
        preferred,
        options.parts,
      );
      console.log(`[gemini] using ${preferred}`);
      return {
        text,
        modelUsed: preferred,
        fellBack: false,
        notice: null,
      };
    } catch (error) {
      if (errorStatus(error) !== 404) throw error;
      console.warn(
        `[gemini] ${preferred} returned 404. Discovering a live flash model...`,
      );
    }
  }

  const listed = await listGeminiGenerateModels(options.apiKey);
  const candidates = rankFlashModelIds(listed).filter((id) => id !== preferred);
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
        ? `โมเดลที่ตั้งไว้ (${preferred}) ใช้ไม่ได้ ระบบใช้ ${modelName} จาก Google API แทน — อัปเดตได้ที่ตั้งค่าระบบ`
        : `ไม่ได้ตั้งค่าโมเดล ระบบใช้ ${modelName} จาก Google API`;
      console.warn(`[gemini] ${notice}`);
      return {
        text,
        modelUsed: modelName,
        fellBack: true,
        notice,
      };
    } catch (error) {
      lastError = error;
      if (errorStatus(error) === 404) continue;
      throw error;
    }
  }

  const detail =
    lastError instanceof Error ? lastError.message : "ไม่ทราบสาเหตุ";
  throw new Error(`เรียก Gemini ไม่สำเร็จ: ${detail}`);
}
