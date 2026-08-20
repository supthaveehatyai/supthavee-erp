"use server";

/**
 * Phase 8 — Expense AI OCR Server Action.
 *
 * NOTE: Do NOT export route segment config (e.g. `maxDuration`) from this file.
 * Next.js requires `"use server"` modules to export async functions only.
 * Set `export const maxDuration = 60` on `app/(erp)/expenses/create/page.tsx`.
 *
 * Zero Client-Side Fetching: the Client never calls Gemini or
 * `supabase.functions.invoke`. This action converts the uploaded File to
 * Base64 server-side, then invokes Edge Function `ocr-expense` with the
 * signed-in user's JWT (`sub` claim) so gateway `verify_jwt` succeeds.
 *
 * Never throws — all failures return `{ success: false, error }` so Next.js
 * Production does not censor the message as an unhandled Server Action error.
 */

import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";
import type {
  ExpenseOcrExtraction,
  ExpenseOcrVatType,
  ProcessExpenseOcrResult,
} from "@/types/expense";

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

/* -------------------------------------------------------------------------- */
/* Result helpers (never throw)                                               */
/* -------------------------------------------------------------------------- */

function fail(error: string): ProcessExpenseOcrResult {
  return { success: false, error };
}

function ok(data: ExpenseOcrExtraction): ProcessExpenseOcrResult {
  return { success: true, data };
}

/* -------------------------------------------------------------------------- */
/* Auth JWT (SSR session — required by verify_jwt)                            */
/* -------------------------------------------------------------------------- */

function isGenericInvokeError(message: string): boolean {
  return /non-2xx status code|missing sub claim/i.test(message);
}

/**
 * User JWT from Auth cookies — required by Edge Functions with `verify_jwt`.
 * Service Role / anon keys have no `sub` claim and are rejected by the gateway.
 * Never throws.
 */
async function resolveUserAccessToken(): Promise<
  { token: string } | { error: string }
> {
  try {
    const supabase = await createSupabaseSSRClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user?.id) {
      return { error: "กรุณาเข้าสู่ระบบก่อนใช้ Expense OCR" };
    }

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const token = session?.access_token?.trim();
    if (!token) {
      return {
        error: "ไม่พบ Access Token — กรุณาเข้าสู่ระบบใหม่แล้วลองอีกครั้ง",
      };
    }

    return { token };
  } catch (err) {
    console.error("[ocr-expense] resolveUserAccessToken failed:", err);
    return {
      error:
        err instanceof Error
          ? err.message
          : "ไม่สามารถอ่าน Session ผู้ใช้ได้",
    };
  }
}

/**
 * `functions.invoke()` collapses non-2xx into a generic FunctionsHttpError.
 * Unwrap `{ error: string }` from `error.context` when available.
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

    console.error(
      "[ocr-expense] invoke error.context status:",
      record.status ?? null,
    );

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
            const parsed = JSON.parse(text) as {
              error?: unknown;
              message?: unknown;
            };
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
        console.error(
          "[ocr-expense] failed to read invoke error.text()",
          readErr,
        );
      }
    }

    if (typeof bodySource.json === "function") {
      try {
        const body = (await bodySource.json()) as {
          error?: unknown;
          message?: unknown;
        };
        console.error("[ocr-expense] invoke error JSON:", body);
        if (typeof body?.error === "string" && body.error.trim()) {
          return body.error;
        }
        if (typeof body?.message === "string" && body.message.trim()) {
          return body.message;
        }
      } catch (jsonErr) {
        console.error(
          "[ocr-expense] failed to parse invoke error.json()",
          jsonErr,
        );
      }
    }

    if (typeof record.error === "string" && record.error.trim()) {
      return record.error;
    }
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

/* -------------------------------------------------------------------------- */
/* Normalization & safe JSON parsing                                          */
/* -------------------------------------------------------------------------- */

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

function safeParseSanitizedJson(
  rawText: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    const cleanJson = sanitizeJsonText(rawText);
    console.log("[ocr-expense] Cleaned JSON:", cleanJson.slice(0, 2000));
    if (!cleanJson) {
      return { ok: false, error: "AI ส่งข้อมูลกลับมาผิดรูปแบบ (JSON ว่าง)" };
    }
    return { ok: true, value: JSON.parse(cleanJson) };
  } catch (err) {
    console.error("[ocr-expense] JSON.parse failed:", err);
    return {
      ok: false,
      error: "AI ส่งข้อมูลกลับมาผิดรูปแบบ (parse JSON ไม่สำเร็จ)",
    };
  }
}

function looksLikeExtractionObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const root = value as Record<string, unknown>;
  return (
    "vendor_name" in root ||
    "grand_total" in root ||
    "sub_total" in root ||
    "items" in root
  );
}

/**
 * Resolve Edge Function payload → raw extraction object or JSON string.
 * Supports `{ data }`, plain extraction object, or `{ text|result|message }`.
 */
function resolveExtractionPayload(
  body: unknown,
): { payload: unknown } | { error: string } {
  if (body == null) {
    return { error: "AI ส่งข้อมูลกลับมาผิดรูปแบบ (response ว่าง)" };
  }

  if (typeof body === "string") {
    const trimmed = body.trim();
    if (!trimmed) {
      return { error: "AI ส่งข้อมูลกลับมาผิดรูปแบบ (response ว่าง)" };
    }
    return { payload: trimmed };
  }

  if (typeof body !== "object" || Array.isArray(body)) {
    return { error: "AI ส่งข้อมูลกลับมาผิดรูปแบบ (ไม่ใช่ JSON object)" };
  }

  const record = body as Record<string, unknown>;

  if (typeof record.error === "string" && record.error.trim()) {
    return { error: record.error.trim() };
  }

  if (record.data != null) {
    return resolveExtractionPayload(record.data);
  }

  const rawText =
    (typeof record.text === "string" && record.text) ||
    (typeof record.result === "string" && record.result) ||
    (typeof record.message === "string" && record.message) ||
    null;

  if (rawText?.trim()) {
    return { payload: rawText.trim() };
  }

  if (looksLikeExtractionObject(record)) {
    return { payload: record };
  }

  return { error: "AI ส่งข้อมูลกลับมาผิดรูปแบบ (ไม่พบฟิลด์ OCR)" };
}

function unwrapExtractionPayload(
  raw: unknown,
): { payload: Record<string, unknown> } | { error: string } {
  const resolved = resolveExtractionPayload(raw);
  if ("error" in resolved) return resolved;

  let payload = resolved.payload;

  if (typeof payload === "string") {
    const parsed = safeParseSanitizedJson(payload);
    if (!parsed.ok) return { error: parsed.error };
    payload = parsed.value;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { error: "AI ส่งข้อมูลกลับมาผิดรูปแบบ (ไม่ใช่ JSON object)" };
  }

  const root = payload as Record<string, unknown>;
  if (root.data != null) {
    return unwrapExtractionPayload(root.data);
  }

  return { payload: root };
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

function normalizeExtraction(raw: unknown): ProcessExpenseOcrResult {
  try {
    const unwrapped = unwrapExtractionPayload(raw);
    if ("error" in unwrapped) return fail(unwrapped.error);

    const root = unwrapped.payload;
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
        root.document_date ??
          root.documentDate ??
          root.invoice_date ??
          root.date,
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

    if (isEmptyExtraction(normalized)) {
      console.error("[ocr-expense] empty extraction after normalize:", raw);
      return fail(
        "OCR อ่านบิลไม่สำเร็จ — ไม่พบข้อมูลที่ใช้ได้ (vendor / ยอดเงิน / รายการว่าง)",
      );
    }

    return ok(normalized);
  } catch (err) {
    console.error("[ocr-expense] normalizeExtraction unexpected:", err);
    return fail("OCR ประมวลผลข้อมูลไม่สำเร็จ — กรุณาลองใหม่อีกครั้ง");
  }
}

function safeParseFetchBody(rawText: string): unknown | null {
  try {
    if (!rawText.trim()) return null;
    return JSON.parse(rawText) as unknown;
  } catch (err) {
    console.error("[ocr-expense] safeParseFetchBody failed:", err);
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Edge Function invoke                                                       */
/* -------------------------------------------------------------------------- */

async function fetchOcrExpenseDirect(
  imageBase64: string,
  mimeType: string,
  accessToken: string,
): Promise<ProcessExpenseOcrResult> {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl) {
      return fail("Missing NEXT_PUBLIC_SUPABASE_URL environment variable");
    }

    const bearer =
      accessToken.trim() || anonKey?.trim() || "";
    if (!bearer) {
      return fail(
        "ไม่พบ Access Token หรือ NEXT_PUBLIC_SUPABASE_ANON_KEY",
      );
    }

    const payload = { image_base64: imageBase64, mime_type: mimeType };
    const url = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/ocr-expense`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${bearer}`,
        apikey: anonKey ?? bearer,
      },
      body: JSON.stringify(payload),
    });

    const rawText = await response.text();
    const body = safeParseFetchBody(rawText);

    if (!response.ok) {
      console.error(
        "[ocr-expense] direct fetch status:",
        response.status,
        "body:",
        rawText.slice(0, 1000),
      );
      const status = response.status;
      if (status === 503 || status === 429) {
        return fail(
          `AI OCR ชั่วคราวไม่พร้อม (HTTP ${status}) — ลองใหม่ในอีกสักครู่`,
        );
      }
      const record = body as { error?: string } | null;
      const detail =
        record?.error ??
        (rawText.trim()
          ? rawText.slice(0, 500)
          : `ocr-expense failed (HTTP ${status})`);
      return fail(detail);
    }

    if (body == null) {
      return fail("AI ส่งข้อมูลกลับมาผิดรูปแบบ (response body ไม่ใช่ JSON)");
    }

    return normalizeExtraction(body);
  } catch (err) {
    console.error("[ocr-expense] direct fetch failed:", err);
    const message =
      err instanceof Error
        ? err.message
        : "ไม่สามารถเชื่อมต่อ Edge Function ocr-expense";
    return fail(message);
  }
}

async function invokeOcrExpenseEdge(
  imageBase64: string,
  mimeType: string,
): Promise<ProcessExpenseOcrResult> {
  try {
    const auth = await resolveUserAccessToken();
    if ("error" in auth) {
      return fail(auth.error);
    }

    const payload = {
      image_base64: imageBase64,
      mime_type: mimeType,
    };

    const supabaseSsr = await createSupabaseSSRClient();
    const { data, error } = await supabaseSsr.functions.invoke("ocr-expense", {
      body: payload,
      headers: {
        Authorization: `Bearer ${auth.token}`,
      },
    });

    if (error) {
      const message = await extractEdgeFunctionErrorMessage(error);
      console.error("[ocr-expense] functions.invoke error message:", message);

      if (isGenericInvokeError(message)) {
        console.warn(
          "[processExpenseOCR] generic non-2xx — trying direct fetch fallback",
        );
        return await fetchOcrExpenseDirect(imageBase64, mimeType, auth.token);
      }

      if (/\b(503|429)\b/.test(message)) {
        return fail(
          `AI OCR ชั่วคราวไม่พร้อม (${message.includes("429") ? "429 rate limit" : "503 unavailable"}) — ลองใหม่ในอีกสักครู่`,
        );
      }
      return fail(message);
    }

    if (data == null) {
      return fail("Edge Function ocr-expense ไม่คืนข้อมูล");
    }

    return normalizeExtraction(data);
  } catch (invokeErr) {
    console.error(
      "[processExpenseOCR] functions.invoke threw — trying fetch fallback",
      invokeErr,
    );
    const auth = await resolveUserAccessToken();
    if ("error" in auth) {
      return fail(auth.error);
    }
    return await fetchOcrExpenseDirect(imageBase64, mimeType, auth.token);
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
  try {
    const file = formData.get("file");

    if (!(file instanceof File) || file.size === 0) {
      return fail("ไม่พบไฟล์รูปบิล กรุณาอัปโหลดไฟล์ก่อน");
    }

    const mimeType = (file.type || "image/jpeg").toLowerCase();
    if (!ALLOWED_MIME.has(mimeType) && !mimeType.startsWith("image/")) {
      return fail("รองรับเฉพาะไฟล์รูปภาพ (.jpg, .png, .webp)");
    }

    const maxBytes = 8 * 1024 * 1024;
    if (file.size > maxBytes) {
      return fail("ไฟล์ใหญ่เกิน 8MB — กรุณาลดขนาดรูปแล้วลองใหม่");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const imageBase64 = buffer.toString("base64");

    return await invokeOcrExpenseEdge(
      imageBase64,
      mimeType === "image/jpg" ? "image/jpeg" : mimeType,
    );
  } catch (err) {
    console.error("[processExpenseOCR] unexpected:", err);
    const message =
      err instanceof Error
        ? err.message
        : "เกิดข้อผิดพลาดขณะประมวลผล Expense OCR";
    return fail(message);
  }
}
