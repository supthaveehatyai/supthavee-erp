// supabase/functions/ocr-expense/index.ts
//
// AI Vision OCR for Expense (OPEX) receipts — Gemini extracts header +
// soft line items (description / amount / category_hint). No SKU mapping,
// no inventory, and no `contacts` query (`contact_type` / `contact_roles`
// are handled in Next.js Server Actions only).
// Invoked from Next.js Server Actions via service-role or authenticated user JWT.
//
// Deploy: supabase functions deploy ocr-expense
// Secret:  supabase secrets set GEMINI_API_KEY=...
// Optional: supabase secrets set GEMINI_MODEL=... (overrides cascade primary)
//
// OCR Resiliency Engine (Phase 3 standard) — model cascade:
//   gemini-3.6-flash → gemini-3.5-flash → gemini-2.5-flash
// - 503 / 429 → retry up to 3× with exponential backoff, then next model
// - 404 / 400 → skip retries; fall through to next model immediately

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

type ExpenseOcrItem = {
  description: string;
  amount: number;
  category_hint: string;
};

type ExpenseOcrExtraction = {
  vendor_name: string | null;
  tax_id: string | null;
  document_number: string | null;
  document_date: string | null;
  vat_type: "INCLUSIVE" | "EXCLUSIVE" | "NONE";
  sub_total: number;
  vat_amount: number;
  grand_total: number;
  items: ExpenseOcrItem[];
};

type HttpError = Error & { status?: number };

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function httpError(message: string, status: number): HttpError {
  const err = new Error(message) as HttpError;
  err.status = status;
  return err;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function getErrorStatus(error: unknown): number | undefined {
  if (error != null && typeof error === "object") {
    const record = error as Record<string, unknown>;
    const direct = record.status ?? record.statusCode;
    if (typeof direct === "number") return direct;

    const nested = record.error;
    if (nested != null && typeof nested === "object") {
      const nestedRecord = nested as Record<string, unknown>;
      const nestedStatus = nestedRecord.status ?? nestedRecord.code;
      if (typeof nestedStatus === "number") return nestedStatus;
    }
  }

  const message = getErrorMessage(error);
  const match = message.match(/\b(400|401|403|404|429|503)\b/);
  if (match) return Number(match[1]);
  return undefined;
}

/**
 * Active OCR Resiliency Engine cascade (retired 1.5 / 2.0 removed).
 * Optional `GEMINI_MODEL` secret prepends as the first attempt.
 */
const DEFAULT_MODEL_CASCADE = [
  "gemini-3.6-flash", // Primary
  "gemini-3.5-flash", // Secondary fallback
  "gemini-2.5-flash", // Final fallback
] as const;

function resolveModelCascade(): string[] {
  const override = Deno.env.get("GEMINI_MODEL")?.trim();
  const cascade = [...DEFAULT_MODEL_CASCADE];
  if (
    override &&
    !cascade.includes(override as (typeof DEFAULT_MODEL_CASCADE)[number])
  ) {
    return [override, ...cascade];
  }
  if (override) {
    return [override, ...cascade.filter((m) => m !== override)];
  }
  return cascade;
}

type GenerativePart =
  | string
  | { inlineData: { mimeType: string; data: string } };

/**
 * OCR Resiliency Engine — try each Gemini model in cascade.
 * - 503 / 429 → retry up to 3× with exponential backoff, then next model
 * - 404 / 400 → do NOT retry; fall through to next model immediately
 * Preserves JSON responseMimeType for OPEX schema parsing.
 */
async function generateWithRetryAndFallback(
  genAI: GoogleGenerativeAI,
  prompt: string,
  imageParts: GenerativePart[],
): Promise<string> {
  let lastError: unknown = null;
  const models = resolveModelCascade();

  for (const modelName of models) {
    console.log(`[ocr-expense] Attempting with model: ${modelName}`);
    const model = genAI.getGenerativeModel({
      model: modelName,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const result = await model.generateContent([prompt, ...imageParts]);
        const text = result.response.text();
        if (!text?.trim()) {
          throw new Error("Gemini returned empty response");
        }
        console.log(`[ocr-expense] Success with model: ${modelName}`);
        return text;
      } catch (error: unknown) {
        lastError = error;
        const status = getErrorStatus(error);

        // Retired / invalid model — skip retries, next model in cascade.
        if (status === 404 || status === 400) {
          console.warn(
            `[ocr-expense] Model ${modelName} returned ${status}. Skipping retries, falling back to next model...`,
            getErrorMessage(error),
          );
          break;
        }

        // Capacity / rate limit — exponential backoff, then next model.
        if (status === 503 || status === 429) {
          if (attempt < 3) {
            const delayMs = attempt * 1500; // 1.5s, 3.0s
            console.warn(
              `[ocr-expense] Model ${modelName} hit ${status}. Retrying in ${delayMs}ms... (Attempt ${attempt}/3)`,
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
            continue;
          }
          console.warn(
            `[ocr-expense] Model ${modelName} exhausted retries on ${status}. Falling back to next model...`,
            getErrorMessage(error),
          );
          break;
        }

        console.warn(
          `[ocr-expense] Model ${modelName} failed on attempt ${attempt}. Switching model...`,
          getErrorMessage(error),
        );
        break;
      }
    }
  }

  throw httpError(
    `All Gemini Models failed. Last error: ${getErrorMessage(lastError) || "Service Unavailable"}`,
    502,
  );
}

function buildOpexSystemPrompt(): string {
  return `
You are an Expert ERP OCR System specialized in reading Thai operating-expense receipts and invoices (ใบเสร็จ / ใบกำกับภาษี / บิลค่าใช้จ่าย) for OPEX — NOT inventory purchase bills.

Extract data from the photographed or scanned image and respond with ONLY a valid JSON object — no markdown code fences, no commentary — matching EXACTLY this schema:

{
  "vendor_name": "string (or null if not found)",
  "tax_id": "string (or null)",
  "document_number": "string (or null)",
  "document_date": "YYYY-MM-DD (or null)",
  "vat_type": "INCLUSIVE | EXCLUSIVE | NONE",
  "sub_total": number,
  "vat_amount": number,
  "grand_total": number,
  "items": [
    {
      "description": "string",
      "amount": number,
      "category_hint": "string (TRANSPORT | UTILITIES | OFFICE_SUPPLY | MAINTENANCE | SALARY | OTHER)"
    }
  ]
}

Rules:
- vendor_name: company / shop / payee name printed on the receipt. null if not visible.
- tax_id: Thai tax ID (เลขประจำตัวผู้เสียภาษี) if printed; digits only preferred. null if not found.
- document_number: invoice / receipt number (เลขที่). Return exactly as printed. null if not found — NEVER invent one.
- document_date: main document date. Thai invoices often use Buddhist Era (พ.ศ.). Convert พ.ศ. → ค.ศ. (subtract 543) and return ISO "YYYY-MM-DD". null if not confidently parseable — NEVER invent a date.
- vat_type:
  - "EXCLUSIVE" if VAT 7% is added after a net/subtotal
  - "INCLUSIVE" if prices already include VAT
  - "NONE" if no VAT is present
- sub_total: amount before VAT (or the net base). Use 0 if unknown.
- vat_amount: VAT amount. Use 0 if none/unknown.
- grand_total: final payable total. Prefer the printed grand total over recomputation.
- items: one row per visible charge/service line (not SKU inventory). If the receipt is a single lump-sum with no line breakdown, return one item using the main description and grand/sub total as amount.
- category_hint: guess one of TRANSPORT, UTILITIES, OFFICE_SUPPLY, MAINTENANCE, SALARY, OTHER from the description/context.
- All money fields MUST be plain numbers — no currency symbols, no thousands separators.
- If a string field is not found, use null (not empty string). If a number is not found, use 0.
- Respond with ONLY the JSON object.
`.trim();
}

/** Strip ```json fences and isolate the first JSON object. */
function extractJsonObjectText(rawText: string): string {
  const cleaned = rawText
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const objectMatch = /\{[\s\S]*\}/.exec(cleaned);
  return objectMatch ? objectMatch[0] : cleaned;
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  const isReal =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return isReal ? trimmed : null;
}

function normalizeVatType(value: unknown): ExpenseOcrExtraction["vat_type"] {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "INCLUSIVE" || raw.includes("INCLUSIVE")) return "INCLUSIVE";
  if (raw === "EXCLUSIVE" || raw.includes("EXCLUSIVE")) return "EXCLUSIVE";
  if (raw === "NONE" || raw === "NO_VAT" || raw === "NOVAT") return "NONE";
  return "NONE";
}

function normalizeNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function normalizeAmount(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value * 100) / 100;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[,฿\s]/g, "").trim();
    const n = Number(cleaned);
    if (Number.isFinite(n)) return Math.round(n * 100) / 100;
  }
  return 0;
}

function normalizeCategoryHint(value: unknown): string {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  const allowed = new Set([
    "TRANSPORT",
    "UTILITIES",
    "OFFICE_SUPPLY",
    "MAINTENANCE",
    "SALARY",
    "OTHER",
  ]);

  if (allowed.has(raw)) return raw;
  if (raw.includes("TRANSPORT") || raw.includes("SHIP") || raw.includes("ขนส่ง")) {
    return "TRANSPORT";
  }
  if (raw.includes("UTIL") || raw.includes("น้ำ") || raw.includes("ไฟ")) {
    return "UTILITIES";
  }
  if (raw.includes("OFFICE") || raw.includes("SUPPLY") || raw.includes("วัสดุ")) {
    return "OFFICE_SUPPLY";
  }
  if (raw.includes("MAINT") || raw.includes("ซ่อม")) return "MAINTENANCE";
  if (raw.includes("SALARY") || raw.includes("เงินเดือน") || raw.includes("ค่าจ้าง")) {
    return "SALARY";
  }
  return "OTHER";
}

function parseExpenseOcrJson(rawText: string): ExpenseOcrExtraction {
  const jsonSlice = extractJsonObjectText(rawText);
  console.log("[ocr-expense] Cleaned JSON:", jsonSlice.slice(0, 2000));

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    throw httpError(
      "Gemini ตอบกลับไม่เป็น JSON ที่ถูกต้อง (parse ไม่สำเร็จ)",
      502,
    );
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw httpError(
      "Gemini ตอบกลับไม่ใช่ JSON object ตาม schema ที่กำหนด",
      502,
    );
  }

  const root = parsed as Record<string, unknown>;
  const rawItems = Array.isArray(root.items) ? root.items : [];

  const items: ExpenseOcrItem[] = rawItems.map((row) => {
    const item = (row ?? {}) as Record<string, unknown>;
    return {
      description: normalizeNullableString(item.description) ?? "",
      amount: normalizeAmount(item.amount),
      category_hint: normalizeCategoryHint(item.category_hint),
    };
  });

  return {
    vendor_name: normalizeNullableString(root.vendor_name),
    tax_id: normalizeNullableString(root.tax_id),
    document_number: normalizeNullableString(root.document_number),
    document_date: normalizeIsoDate(root.document_date),
    vat_type: normalizeVatType(root.vat_type),
    sub_total: normalizeAmount(root.sub_total),
    vat_amount: normalizeAmount(root.vat_amount),
    grand_total: normalizeAmount(root.grand_total),
    items,
  };
}

/* -------------------------------------------------------------------------- */
/* Auth                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Validate Authorization Bearer token.
 * - Service Role key: trusted Server Action path (Zero Client-Side Fetching)
 * - User JWT: validated via supabase.auth.getUser(jwt)
 */
async function requireAuthorization(req: Request): Promise<void> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw httpError("Missing or invalid Authorization header", 401);
  }

  const jwt = authHeader.slice("Bearer ".length).trim();
  if (!jwt) {
    throw httpError("Missing JWT token", 401);
  }

  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceRoleKey && jwt === serviceRoleKey) {
    return; // Trusted invoke from Next.js Server Action (supabaseAdmin)
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !supabaseAnonKey) {
    throw httpError(
      "Missing SUPABASE_URL or SUPABASE_ANON_KEY on this Edge Function",
      500,
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await supabase.auth.getUser(jwt);
  if (error || !data.user) {
    throw httpError(
      error?.message ?? "Unauthorized — invalid or expired JWT",
      401,
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw httpError("Method not allowed — use POST", 405);
    }

    await requireAuthorization(req);

    const body = await req.json().catch(() => {
      throw httpError("Request body must be valid JSON", 400);
    });

    const imageBase64 = String(body?.image_base64 ?? "").trim();
    const mimeType = String(body?.mime_type ?? "image/jpeg").trim() ||
      "image/jpeg";

    if (!imageBase64) {
      throw httpError('Missing required field: "image_base64"', 400);
    }

    if (!mimeType.startsWith("image/")) {
      throw httpError(
        'Invalid "mime_type" — expected an image/* MIME type',
        400,
      );
    }

    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      throw httpError("Missing GEMINI_API_KEY secret on this Edge Function", 500);
    }

    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const rawText = await generateWithRetryAndFallback(
      genAI,
      buildOpexSystemPrompt(),
      [{ inlineData: { mimeType, data: imageBase64 } }],
    );

    const data = parseExpenseOcrJson(rawText);
    return jsonResponse({ data });
  } catch (error) {
    const message = getErrorMessage(error);
    const status =
      typeof (error as HttpError)?.status === "number"
        ? (error as HttpError).status!
        : 500;

    console.error("[ocr-expense] Error:", message, { status });
    // HTTP 200 + `{ error }` so supabase-js `functions.invoke` does not
    // collapse the real message into a generic "non-2xx status code".
    // Auth still runs in requireAuthorization(); this only affects the
    // JSON envelope the Server Action unwraps.
    return jsonResponse({ error: message, status }, 200);
  }
});
