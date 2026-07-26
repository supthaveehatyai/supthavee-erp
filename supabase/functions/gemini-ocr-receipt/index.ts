// supabase/functions/gemini-ocr-receipt/index.ts
//
// Generic Gemini Vision OCR for receipt/invoice line items. Unlike
// `process-receipt-ocr` (which looks up `ocr_pattern_config` from the
// `contacts` table via a vendorId), this function is fully stateless: the
// caller sends the image AND the pattern config directly in the request
// body — no Supabase client, no DB lookup. Useful for ad-hoc / preview OCR
// calls where the vendor config is already in hand on the client/server
// action side.
//
// Bulletproof error handling: the ENTIRE handler body runs inside one
// try/catch. Every exit path (success AND failure) returns a proper JSON
// Response with CORS headers, so the caller never sees a raw/opaque
// "non-2xx status code" — it always gets `{ data }` or `{ error }`.
//
// Deploy: supabase functions deploy gemini-ocr-receipt
// Secret:  supabase secrets set GEMINI_API_KEY=...
// Optional: supabase secrets set GEMINI_MODEL=gemini-1.5-flash (default)
//
// NOTE: intentionally UNpinned (no @version) — always resolves to the
// latest stable @google/generative-ai. If a future SDK version starts
// 404-ing again, the fallback model string below is the safety net; also
// check https://ai.google.dev/gemini-api/docs/models/gemini for currently
// supported model IDs before re-pinning.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// Deno / Supabase Edge: use npm: specifiers (do NOT use bare `@google/...` or esm.sh)
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** The exact output shape requested for every extracted line item. */
type OcrReceiptItem = {
  raw_vendor_sku: string;
  qty: number;
  unit_price: number;
  discount_text: string;
};

/** Never trust `error` to be an `Error` instance — coerce safely for logging/response. */
function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown OCR error";
  }
}

/**
 * Build the strict system prompt for invoice OCR, injecting the caller-
 * supplied `ocrPatternConfig` as parsing hints (column/table layout rules,
 * vendor quirks, etc — whatever shape the caller decides to send).
 *
 * Crucial Flattening Rule: many Thai wholesale invoices lay out quantities
 * as a "Size Matrix" (one row per code/color, one column per size). Gemini
 * MUST flatten every non-zero size column into its own line, combining
 * Code + Color + Size into `raw_vendor_sku` (e.g. "EA1331-DD-S", qty 15).
 */
function buildOcrSystemPrompt(ocrPatternConfig: unknown): string {
  return `
You are an Expert ERP OCR System specialized in reading Thai wholesale/retail clothing invoices (บิลซื้อ) from a photographed or scanned image.

Layout hints (ocrPatternConfig — use these column/table rules when present, otherwise infer from the image):
${JSON.stringify(ocrPatternConfig ?? {})}

CRUCIAL FLATTENING RULE — Size Matrix:
Some invoices show one product row (code + color) with MULTIPLE size columns (e.g. XS, S, M, L, XL) each holding its own quantity. You MUST flatten this into one output row PER size column that has a quantity greater than 0. Combine the product code, color, and that size into "raw_vendor_sku" as "{Code}-{Color}-{Size}".
Example: row code "EA1331", color "DD", with qty 15 under the "S" column and qty 8 under the "M" column → TWO separate output rows: {"raw_vendor_sku": "EA1331-DD-S", "qty": 15, ...} AND {"raw_vendor_sku": "EA1331-DD-M", "qty": 8, ...}. Never merge sizes into one row, and never output a row for a size column with quantity 0 or blank.

Other rules:
- Extract EVERY line item visible on the invoice — never skip rows.
- "raw_vendor_sku" = the factory/vendor product code exactly as printed, flattened per the rule above — this is Ground Truth, NEVER invent or guess an internal SKU.
- "discount_text" examples: "40%", "41.8%", "40+5%", "50", or "" if no discount.
- "qty" and "unit_price" MUST be plain numbers — no currency symbols, no thousands separators.
- Respond with ONLY a valid JSON array — no markdown code fences, no commentary, no trailing text — matching EXACTLY this shape:
[{"raw_vendor_sku": "", "qty": 0, "unit_price": 0, "discount_text": ""}]
`.trim();
}

/** Strip ```json fences (if any) and isolate the first JSON array in the text. */
function extractJsonArrayText(rawText: string): string {
  const cleaned = rawText
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const arrayMatch = /\[[\s\S]*\]/.exec(cleaned);
  return arrayMatch ? arrayMatch[0] : cleaned;
}

/** Parse + coerce Gemini's JSON text into `OcrReceiptItem[]`, throws on unparsable/wrong-shape text. */
function parseOcrItemsJson(rawText: string): OcrReceiptItem[] {
  const jsonSlice = extractJsonArrayText(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    throw new Error("Gemini ตอบกลับไม่เป็น JSON ที่ถูกต้อง (parse ไม่สำเร็จ)");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("Gemini ตอบกลับไม่ใช่ JSON array ของรายการสินค้า");
  }

  return parsed.map((row) => {
    const item = (row ?? {}) as Record<string, unknown>;
    return {
      raw_vendor_sku: String(item.raw_vendor_sku ?? "").trim(),
      qty: Number(item.qty) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_text: String(item.discount_text ?? "").trim(),
    };
  });
}

serve(async (req: Request) => {
  // Handle CORS preflight immediately — before any parsing/try-catch.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      throw new Error("Method not allowed — use POST");
    }

    // 1. Parse the request JSON
    const body = await req.json().catch(() => {
      throw new Error("Request body ไม่เป็น JSON ที่ถูกต้อง");
    });

    const base64Image = body?.base64Image as string | undefined;
    const ocrPatternConfig = body?.ocrPatternConfig ?? {};
    const mimeType = (body?.mimeType as string | undefined) || "image/jpeg";

    if (!base64Image || typeof base64Image !== "string") {
      throw new Error("Missing required parameter: base64Image");
    }
    if (typeof ocrPatternConfig !== "object" || ocrPatternConfig === null) {
      throw new Error("ocrPatternConfig ต้องเป็น object");
    }

    // 2. Initialize GoogleGenerativeAI explicitly
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      throw new Error("Missing GEMINI_API_KEY secret on this Edge Function");
    }
    const genAI = new GoogleGenerativeAI(geminiApiKey);

    // 3. Gemini Vision — flatten the Size Matrix into OcrReceiptItem[]
    const geminiModel = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-1.5-flash";
    const model = genAI.getGenerativeModel({
      model: geminiModel,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    const systemPrompt = buildOcrSystemPrompt(ocrPatternConfig);

    // Strip a `data:image/...;base64,` prefix if the caller sent a data URL.
    const inlineData = base64Image.includes(",")
      ? base64Image.slice(base64Image.indexOf(",") + 1)
      : base64Image;

    const result = await model.generateContent([
      systemPrompt,
      { inlineData: { mimeType, data: inlineData } },
    ]);

    const rawText = result.response.text();
    if (!rawText?.trim()) {
      throw new Error("Gemini ไม่ได้ตอบข้อมูลใดๆ กลับมา (empty response)");
    }

    const resultData = parseOcrItemsJson(rawText);

    // 4. Success — always JSON + CORS headers
    return new Response(JSON.stringify({ data: resultData }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    // Bulletproof: log server-side, and always return valid JSON + CORS
    // headers to the client — never let a raw/opaque non-2xx leak through.
    const message = getErrorMessage(error);
    console.error("Gemini OCR Receipt Edge Function Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
