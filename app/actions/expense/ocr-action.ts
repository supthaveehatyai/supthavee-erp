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

function isGenericInvokeError(message: string): boolean {
  return /non-2xx status code/i.test(message);
}

/**
 * `functions.invoke()` collapses non-2xx into a generic FunctionsHttpError.
 * The Edge Function always returns `{ error: string }` — unwrap it from
 * `error.context` (raw Response / Response-like), then log the real body.
 */
async function extractEdgeFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback =
    error instanceof Error
      ? error.message
      : "เรียก Edge Function ocr-expense ไม่สำเร็จ";

  console.error("[ocr-expense] functions.invoke raw error:", error);

  const context = (error as { context?: unknown; details?: unknown })?.context;
  const details = (error as { details?: unknown })?.details;

  async function readContextBody(ctx: unknown): Promise<string | null> {
    if (ctx == null) return null;

    if (typeof ctx === "string" && ctx.trim()) return ctx;

    if (typeof ctx !== "object") return null;

    const record = ctx as {
      clone?: () => unknown;
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
      status?: number;
      error?: unknown;
      message?: unknown;
    };

    console.error("[ocr-expense] invoke error.context status:", record.status ?? null);

    const readable = typeof record.clone === "function" ? record.clone() : ctx;
    const bodySource = readable as {
      json?: () => Promise<unknown>;
      text?: () => Promise<string>;
    };

    if (typeof bodySource.text === "function") {
      try {
        const text = await bodySource.text();
        if (text?.trim()) {
          console.error("[ocr-expense] invoke error body:", text);
          try {
            const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
            if (typeof parsed?.error === "string" && parsed.error.trim()) {
              return parsed.error;
            }
            if (typeof parsed?.message === "string" && parsed.message.trim()) {
              return parsed.message;
            }
          } catch {
            return text.slice(0, 500);
          }
          return text.slice(0, 500);
        }
      } catch (readErr) {
        console.error("[ocr-expense] failed to read invoke error.text()", readErr);
      }
    }

    if (typeof bodySource.json === "function") {
      try {
        const body = (await bodySource.json()) as { error?: unknown; message?: unknown };
        console.error("[ocr-expense] invoke error JSON:", body);
        if (typeof body?.error === "string" && body.error.trim()) return body.error;
        if (typeof body?.message === "string" && body.message.trim()) {
          return body.message;
        }
      } catch (jsonErr) {
        console.error("[ocr-expense] failed to parse invoke error.json()", jsonErr);
      }
    }

    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }

    return null;
  }

  const fromContext = await readContextBody(context);
  if (fromContext) return fromContext;

  if (typeof details === "string" && details.trim()) {
    console.error("[ocr-expense] invoke error.details:", details);
    return details;
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

function sanitizeJsonText(rawText: string): string {
  const cleaned = rawText
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const objectMatch = /\{[\s\S]*\}/.exec(cleaned);
  return objectMatch ? objectMatch[0] : cleaned;
}

function parseSanitizedJson(rawText: string): unknown {
  const cleanJson = sanitizeJsonText(rawText);
  console.log("[ocr-expense] Cleaned JSON:", cleanJson.slice(0, 2000));
  return JSON.parse(cleanJson);
}

function unwrapExtractionPayload(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return parseSanitizedJson(raw);
    } catch (err) {
      console.error("[ocr-expense] parse sanitized JSON failed:", err);
      return raw;
    }
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;

  const root = raw as Record<string, unknown>;
  if (root.data != null) {
    return unwrapExtractionPayload(root.data);
  }

  return raw;
}

function isEmptyExtraction(data: ExpenseOcrExtraction): boolean {
  const hasVendor = Boolean(data.vendor_name?.trim());
  const hasDoc = Boolean(data.document_number?.trim());
  const hasDate = Boolean(data.document_date);
  const hasMoney = data.grand_total > 0 || data.sub_total > 0;
  const hasItems = data.items.some(
    (item) => item.description.trim().length > 0 || item.amount > 0,
  );
  return !hasVendor && !hasDoc && !hasDate && !hasMoney && !hasItems;
}

function normalizeExtraction(raw: unknown): ExpenseOcrExtraction {
  const payload = unwrapExtractionPayload(raw);

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    console.warn("[ocr-expense] normalizeExtraction: invalid payload", raw);
    return { ...EMPTY_EXTRACTION };
  }

  const root = payload as Record<string, unknown>;
  const rawItems = Array.isArray(root.items) ? root.items : [];

  const normalized: ExpenseOcrExtraction = {
    vendor_name: normalizeNullableString(
      root.vendor_name ?? root.vendorName ?? root.payee_name,
    ),
    tax_id: normalizeNullableString(root.tax_id ?? root.taxId),
    document_number: normalizeNullableString(
      root.document_number ??
        root.documentNumber ??
        root.invoice_number ??
        root.doc_no,
    ),
    document_date: normalizeIsoDate(
      root.document_date ?? root.documentDate ?? root.invoice_date ?? root.date,
    ),
    vat_type: normalizeVatType(root.vat_type ?? root.vatType),
    sub_total: normalizeAmount(
      root.sub_total ?? root.subtotal ?? root.net_amount ?? root.netAmount,
    ),
    vat_amount: normalizeAmount(
      root.vat_amount ?? root.vatAmount ?? root.vat ?? root.tax_amount,
    ),
    grand_total: normalizeAmount(
      root.grand_total ??
        root.grandTotal ??
        root.total ??
        root.total_amount,
    ),
    items: rawItems.map((row) => {
      const item = (row ?? {}) as Record<string, unknown>;
      return {
        description: normalizeNullableString(item.description) ?? "",
        amount: normalizeAmount(item.amount ?? item.line_total),
        category_hint:
          normalizeNullableString(item.category_hint ?? item.categoryHint)
            ?.toUpperCase() ?? "OTHER",
      };
    }),
  };

  console.log("[ocr-expense] normalized extraction:", {
    vendor_name: normalized.vendor_name,
    document_number: normalized.document_number,
    document_date: normalized.document_date,
    grand_total: normalized.grand_total,
    item_count: normalized.items.length,
  });

  return normalized;
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

  async function fetchOcrExpenseDirect(): Promise<{
    data: ExpenseOcrExtraction | null;
    error: string | null;
  }> {
    const resolvedUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const resolvedKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!resolvedUrl) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
    }
    if (!resolvedKey) {
      throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY environment variable");
    }

    const url = `${resolvedUrl.replace(/\/$/, "")}/functions/v1/ocr-expense`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resolvedKey}`,
        apikey: resolvedKey,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    if (!response.ok) {
      console.error(
        "[ocr-expense] direct fetch status:",
        response.status,
        "body:",
        rawText.slice(0, 1000),
      );
    }

    const body = (() => {
      try {
        return JSON.parse(rawText) as { data?: unknown; error?: string };
      } catch {
        return null;
      }
    })();

    if (!response.ok) {
      const status = response.status;
      const detail =
        body?.error ??
        (rawText.trim() ? rawText.slice(0, 500) : `ocr-expense failed (HTTP ${status})`);
      if (status === 503 || status === 429) {
        return {
          data: null,
          error: `AI OCR ชั่วคราวไม่พร้อม (HTTP ${status}) — ลองใหม่ในอีกสักครู่`,
        };
      }
      return { data: null, error: detail };
    }

    if (body?.error) {
      return { data: null, error: body.error };
    }

    const normalized = normalizeExtraction(body?.data ?? body);
    if (isEmptyExtraction(normalized)) {
      console.error("[ocr-expense] empty extraction from direct fetch:", body);
      return {
        data: null,
        error:
          "OCR อ่านบิลไม่สำเร็จ — ไม่พบข้อมูลที่ใช้ได้ (vendor / ยอดเงิน / รายการว่าง)",
      };
    }

    return { data: normalized, error: null };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin.functions.invoke("ocr-expense", {
      body: payload,
    });

    if (error) {
      const message = await extractEdgeFunctionErrorMessage(error);
      console.error("[ocr-expense] functions.invoke error message:", message);

      if (isGenericInvokeError(message)) {
        console.warn(
          "[processExpenseOCR] generic non-2xx — trying direct fetch fallback",
        );
        try {
          return await fetchOcrExpenseDirect();
        } catch (fetchErr) {
          console.error("[ocr-expense] direct fetch fallback failed:", fetchErr);
        }
      }

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
      console.error("[ocr-expense] Edge Function returned error envelope:", envelope.error);
      return { data: null, error: envelope.error };
    }

    const extractionRaw =
      envelope &&
      typeof envelope === "object" &&
      "data" in envelope &&
      envelope.data != null
        ? envelope.data
        : envelope;

    const normalized = normalizeExtraction(extractionRaw);
    if (isEmptyExtraction(normalized)) {
      console.error("[ocr-expense] empty extraction after normalize:", extractionRaw);
      return {
        data: null,
        error:
          "OCR อ่านบิลไม่สำเร็จ — ไม่พบข้อมูลที่ใช้ได้ (vendor / ยอดเงิน / รายการว่าง)",
      };
    }

    return { data: normalized, error: null };
  } catch (invokeErr) {
    console.error(
      "[processExpenseOCR] functions.invoke threw — trying fetch fallback",
      invokeErr,
    );

    try {
      return await fetchOcrExpenseDirect();
    } catch (fetchErr) {
      const message =
        fetchErr instanceof Error
          ? fetchErr.message
          : "ไม่สามารถเชื่อมต่อ Edge Function ocr-expense";
      console.error("[ocr-expense] direct fetch failed:", fetchErr);
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
