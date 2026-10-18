/**
 * Shared Gemini model resolver for OCR Edge Functions.
 * Reads `system_parameters.param_key = GEMINI_MODEL_VERSION` (jsonb).
 */

export const GEMINI_MODEL_PARAM_KEY = "GEMINI_MODEL_VERSION";
export const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";

export function parseGeminiModelParam(raw: unknown): string {
  if (typeof raw === "string") {
    const trimmed = raw.trim().replace(/^["']+|["']+$/g, "");
    return trimmed || DEFAULT_GEMINI_MODEL;
  }
  if (typeof raw === "number" || typeof raw === "boolean") {
    return String(raw);
  }
  if (Array.isArray(raw) && raw.length > 0) {
    return parseGeminiModelParam(raw[0]);
  }
  if (raw && typeof raw === "object") {
    const record = raw as Record<string, unknown>;
    if (typeof record.model === "string") {
      return parseGeminiModelParam(record.model);
    }
    if (typeof record.value === "string") {
      return parseGeminiModelParam(record.value);
    }
  }
  return DEFAULT_GEMINI_MODEL;
}

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

/**
 * Query live Gemini model id from system_parameters.
 * Fallback: gemini-1.5-flash when missing or query fails.
 */
export async function loadGeminiModelVersion(
  supabase: SystemParametersClient,
): Promise<string> {
  try {
    const { data, error } = await supabase
      .from("system_parameters")
      .select("param_value")
      .eq("param_key", GEMINI_MODEL_PARAM_KEY)
      .single();

    if (error) {
      console.warn(
        "[gemini-model] system_parameters query failed, using default:",
        error.message ?? error,
      );
      return DEFAULT_GEMINI_MODEL;
    }

    if (data?.param_value == null) {
      console.warn(
        "[gemini-model] GEMINI_MODEL_VERSION missing, using default",
      );
      return DEFAULT_GEMINI_MODEL;
    }

    const modelName = parseGeminiModelParam(data.param_value);
    console.log(`[gemini-model] using ${modelName}`);
    return modelName;
  } catch (error) {
    console.warn("[gemini-model] unexpected error, using default:", error);
    return DEFAULT_GEMINI_MODEL;
  }
}
