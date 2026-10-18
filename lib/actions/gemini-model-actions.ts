"use server";

import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { listGeminiGenerateModels } from "@/lib/ai/gemini-client";
import type { ListGeminiModelsResult } from "@/types/gemini-model";

/**
 * Live model catalog from Google Generative Language API.
 * Used by Settings so admins pick a model id instead of typing a retired one.
 */
export async function listAvailableGeminiModels(): Promise<ListGeminiModelsResult> {
  try {
    const actor = await getCurrentAuthUser();
    if (!actor?.userId) {
      return { success: false, error: "Forbidden" };
    }

    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return {
        success: false,
        error:
          "ไม่พบ GEMINI_API_KEY บนเซิร์ฟเวอร์ Next.js — ใส่ใน .env.development แล้วรีสตาร์ท",
      };
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
