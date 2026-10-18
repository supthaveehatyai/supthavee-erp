"use server";

import { createClient } from "@supabase/supabase-js";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import {
  GEMINI_API_KEY_MISSING_MESSAGE,
  listGeminiGenerateModels,
  resolveGeminiApiKey,
} from "@/lib/ai/gemini-client";
import type {
  GeminiModelOption,
  ListGeminiModelsResult,
} from "@/types/gemini-model";

async function readInvokeError(error: unknown): Promise<string> {
  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: string } | null;
      if (body?.error) return body.error;
    } catch {
      // non-JSON
    }
  }
  return error instanceof Error ? error.message : "";
}

/**
 * When Vercel has no Gemini key, ask the Edge Function that already holds
 * `GEMINI_API_KEY` in Supabase secrets.
 */
async function listModelsViaEdge(): Promise<ListGeminiModelsResult> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !serviceRoleKey) {
    return { success: false, error: GEMINI_API_KEY_MISSING_MESSAGE };
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  const { data, error } = await supabase.functions.invoke("process-receipt-ocr", {
    body: { action: "LIST_MODELS" },
  });

  if (error) {
    const detail = await readInvokeError(error);
    console.error("[listAvailableGeminiModels] LIST_MODELS invoke:", detail);
    return { success: false, error: GEMINI_API_KEY_MISSING_MESSAGE };
  }

  const payload = data as {
    models?: GeminiModelOption[];
    error?: string;
  } | null;

  if (payload?.error || !Array.isArray(payload?.models) || payload.models.length === 0) {
    console.error(
      "[listAvailableGeminiModels] LIST_MODELS payload:",
      payload?.error ?? "empty models",
    );
    return { success: false, error: GEMINI_API_KEY_MISSING_MESSAGE };
  }

  const models = payload.models.filter(
    (model) =>
      typeof model?.id === "string" &&
      model.id.trim().length > 0,
  );
  if (models.length === 0) {
    return { success: false, error: GEMINI_API_KEY_MISSING_MESSAGE };
  }

  return { success: true, models };
}

/**
 * Live model catalog from Google Generative Language API.
 * Prefers a Next.js/Vercel key; otherwise asks process-receipt-ocr.
 */
export async function listAvailableGeminiModels(): Promise<ListGeminiModelsResult> {
  try {
    const actor = await getCurrentAuthUser();
    if (!actor?.userId) {
      return { success: false, error: "Forbidden" };
    }

    const apiKey = resolveGeminiApiKey();
    if (!apiKey) {
      return listModelsViaEdge();
    }

    const models = await listGeminiGenerateModels(apiKey);
    if (models.length === 0) {
      return {
        success: false,
        error: "Google API ไม่คืนโมเดล gemini ที่รองรับ generateContent",
      };
    }

    return { success: true, models };
  } catch (error: unknown) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "ดึงรายชื่อโมเดลจาก Google ไม่สำเร็จ",
    };
  }
}
