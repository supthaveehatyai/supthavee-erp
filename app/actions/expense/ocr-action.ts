"use server";

/**
 * Phase 8 — Expense AI OCR Server Action.
 *
 * Zero Client-Side Fetching: the Client never calls Gemini or
 * `supabase.functions.invoke`. This action converts the uploaded File to
 * Base64 server-side, then invokes Edge Function `ocr-expense` with the
 * Service Role key (`supabaseAdmin`).
 *
 * FormData (not a raw Base64 string) is required — Next.js Flight protocol
 * blows past nesting limits on multi-MB Base64 strings; File/FormData stream
 * natively.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type {
  ExpenseOcrExtraction,
  ExpenseOcrVatType,
  ProcessExpenseOcrResult,
} from "@/types/expense";

const EMPTY_EXTRACTION: ExpenseOcrExtraction = {
  vendor_name: null,
  tax_id: null,
  document_number: null,
  document_date: null,
  vat_type: "NONE",
  sub_total: 0,
  vat_amount: 0,
  grand_total: 0,
  items: [],
};

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/* -------------------------------------------------------------------------- */
/* Admin client                                                               */
/* -------------------------------------------------------------------------- */

function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env.development แล้วรีสตาร์ท next dev",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * `functions.invoke()` collapses non-2xx into a generic FunctionsHttpError.
 * The Edge Function always returns `{ error: string }` — unwrap it.
 */
async function extractEdgeFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback =
    error instanceof Error
      ? error.message
      : "เรียก Edge Function ocr-expense ไม่สำเร็จ";

  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: string } | null;
      if (body?.error) return body.error;
    } catch {
      // keep fallback
    }
  }

  return fallback;
}

function emptyResult(error: string): ProcessExpenseOcrResult {
  return { data: null, error };
}

function normalizeVatType(value: unknown): ExpenseOcrVatType {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "INCLUSIVE" || raw.includes("INCLUSIVE")) return "INCLUSIVE";
  if (raw === "EXCLUSIVE" || raw.includes("EXCLUSIVE")) return "EXCLUSIVE";
  return "NONE";
}

function normalizeAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
  }
  if (typeof value === "string") {
    const n = Number(value.replace(/[,฿\s]/g, ""));
    if (Number.isFinite(n)) return Math.round((n + Number.EPSILON) * 100) / 100;
  }
  return 0;
}

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  const [y, m, d] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const ok =
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d;
  return ok ? trimmed : null;
}

function normalizeExtraction(raw: unknown): ExpenseOcrExtraction {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...EMPTY_EXTRACTION };
  }

  const root = raw as Record<string, unknown>;
  const rawItems = Array.isArray(root.items) ? root.items : [];

  return {
    vendor_name: normalizeNullableString(root.vendor_name),
    tax_id: normalizeNullableString(root.tax_id),
    document_number: normalizeNullableString(root.document_number),
    document_date: normalizeIsoDate(root.document_date),
    vat_type: normalizeVatType(root.vat_type),
    sub_total: normalizeAmount(root.sub_total),
    vat_amount: normalizeAmount(root.vat_amount),
    grand_total: normalizeAmount(root.grand_total),
    items: rawItems.map((row) => {
      const item = (row ?? {}) as Record<string, unknown>;
      return {
        description: normalizeNullableString(item.description) ?? "",
        amount: normalizeAmount(item.amount),
        category_hint:
          normalizeNullableString(item.category_hint)?.toUpperCase() ?? "OTHER",
      };
    }),
  };
}

/**
 * Invoke `ocr-expense` via supabaseAdmin; fall back to direct fetch against
 * the local/cloud Functions URL when invoke fails with a network-level error.
 */
async function invokeOcrExpenseEdge(
  imageBase64: string,
  mimeType: string,
): Promise<{ data: ExpenseOcrExtraction | null; error: string | null }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return {
      data: null,
      error:
        "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL)",
    };
  }

  const payload = {
    image_base64: imageBase64,
    mime_type: mimeType,
  };

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.functions.invoke("ocr-expense", {
      body: payload,
    });

    if (error) {
      const message = await extractEdgeFunctionErrorMessage(error);
      // Transient capacity — surface clearly for UI retry
      if (/\b(503|429)\b/.test(message)) {
        return {
          data: null,
          error: `AI OCR ชั่วคราวไม่พร้อม (${message.includes("429") ? "429 rate limit" : "503 unavailable"}) — ลองใหม่ในอีกสักครู่`,
        };
      }
      return { data: null, error: message };
    }

    const envelope = data as
      | { data?: unknown; error?: string }
      | ExpenseOcrExtraction
      | null;

    if (
      envelope &&
      typeof envelope === "object" &&
      "error" in envelope &&
      typeof envelope.error === "string" &&
      envelope.error
    ) {
      return { data: null, error: envelope.error };
    }

    const extractionRaw =
      envelope &&
      typeof envelope === "object" &&
      "data" in envelope &&
      envelope.data != null
        ? envelope.data
        : envelope;

    return { data: normalizeExtraction(extractionRaw), error: null };
  } catch (invokeErr) {
    // Fallback: direct fetch to Functions URL (useful for local Edge)
    console.warn(
      "[processExpenseOCR] functions.invoke failed — trying fetch fallback",
      invokeErr,
    );

    try {
      const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/ocr-expense`;
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        },
        body: JSON.stringify(payload),
      });

      const body = (await response.json().catch(() => null)) as {
        data?: unknown;
        error?: string;
      } | null;

      if (!response.ok) {
        const status = response.status;
        if (status === 503 || status === 429) {
          return {
            data: null,
            error: `AI OCR ชั่วคราวไม่พร้อม (HTTP ${status}) — ลองใหม่ในอีกสักครู่`,
          };
        }
        return {
          data: null,
          error: body?.error ?? `ocr-expense failed (HTTP ${status})`,
        };
      }

      if (body?.error) {
        return { data: null, error: body.error };
      }

      return { data: normalizeExtraction(body?.data ?? body), error: null };
    } catch (fetchErr) {
      const message =
        fetchErr instanceof Error
          ? fetchErr.message
          : "ไม่สามารถเชื่อมต่อ Edge Function ocr-expense";
      return { data: null, error: message };
    }
  }
}

/* -------------------------------------------------------------------------- */
/* processExpenseOCR                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Server Action — extract OPEX fields from an uploaded receipt image.
 *
 * Expected FormData keys:
 * - `file` (File) — required image (jpg/png/webp)
 */
export async function processExpenseOCR(
  formData: FormData,
): Promise<ProcessExpenseOcrResult> {
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return emptyResult("ไม่พบไฟล์รูปบิล กรุณาอัปโหลดไฟล์ก่อน");
  }

  const mimeType = (file.type || "image/jpeg").toLowerCase();
  if (!ALLOWED_MIME.has(mimeType) && !mimeType.startsWith("image/")) {
    return emptyResult("รองรับเฉพาะไฟล์รูปภาพ (.jpg, .png, .webp)");
  }

  // Soft size guard (~8MB) — avoids blowing Edge / Gemini payload limits
  const maxBytes = 8 * 1024 * 1024;
  if (file.size > maxBytes) {
    return emptyResult("ไฟล์ใหญ่เกิน 8MB — กรุณาลดขนาดรูปแล้วลองใหม่");
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const imageBase64 = buffer.toString("base64");

    return await invokeOcrExpenseEdge(
      imageBase64,
      mimeType === "image/jpg" ? "image/jpeg" : mimeType,
    );
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "เกิดข้อผิดพลาดขณะประมวลผล Expense OCR";
    console.error("[processExpenseOCR]", message);
    return emptyResult(message);
  }
}
