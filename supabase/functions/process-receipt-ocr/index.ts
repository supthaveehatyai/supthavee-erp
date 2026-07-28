// supabase/functions/process-receipt-ocr/index.ts
//
// AI Vision OCR for Smart Goods Receipt — the ONLY place that talks to
// Gemini directly. `lib/actions/receipt.ts` (Next.js Server Action) invokes
// this function with the service-role admin client; the Gemini API key
// never leaves this Edge Function's own environment.
//
// Bulletproof error handling: the ENTIRE handler body runs inside one
// try/catch. Every exit path (success AND failure) returns a proper JSON
// Response with CORS headers, so the caller never sees a raw/opaque
// "non-2xx status code" — it always gets `{ data }` or `{ error }`.
//
// Deploy: supabase functions deploy process-receipt-ocr
// Secret:  supabase secrets set GEMINI_API_KEY=...
// Optional: supabase secrets set GEMINI_MODEL=gemini-1.5-pro-001 (default)
//
// NOTE: intentionally UNpinned (no @version) — always resolves to the
// latest stable @google/generative-ai. If a future SDK version starts
// 404-ing again, the fallback model string below is the safety net; also
// check https://ai.google.dev/gemini-api/docs/models/gemini for currently
// supported model IDs before re-pinning.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
// Deno / Supabase Edge: use npm: specifiers (do NOT use bare `@supabase/...` or esm.sh)
import { createClient } from "npm:@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/** Matches `RawOcrLine` in `lib/actions/receipt.ts` — keep in sync. */
type RawOcrLine = {
  raw_vendor_sku: string;
  raw_description: string | null;
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

/** Result of parsing Gemini's response — header fields + flattened line items. */
type RawOcrExtraction = {
  document_number: string | null;
  /** ISO `YYYY-MM-DD`, already normalized from Thai Buddhist Era if needed — or `null` if not found. */
  document_date: string | null;
  /** ERP `document_type` subset for goods receipt: TAX_INV | INV_DO | REC */
  doc_type: "TAX_INV" | "INV_DO" | "REC";
  /** ERP `vat_calculation_type`: NONE | INCLUSIVE | EXCLUSIVE */
  vat_type: "NONE" | "INCLUSIVE" | "EXCLUSIVE";
  items: RawOcrLine[];
};

/**
 * `ocr_pattern_config.invoice_no_hint` — a free-text hint admins configure
 * per vendor (via the Contacts "Advanced Settings · OCR Configuration" JSON
 * editor) describing WHERE/HOW that vendor prints their document/invoice
 * number, so Gemini doesn't have to guess blindly on unfamiliar layouts.
 */
function extractInvoiceNoHint(ocrPatternConfig: unknown): string | null {
  if (!ocrPatternConfig || typeof ocrPatternConfig !== "object") return null;
  const raw = (ocrPatternConfig as Record<string, unknown>).invoice_no_hint;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

/**
 * `ocr_pattern_config.invoice_date_hint` — same idea as `invoice_no_hint`,
 * but for locating the invoice/document DATE on that vendor's layout (e.g.
 * "printed next to the doc number, Thai Buddhist Era format วว/ดด/ปปปป").
 */
function extractInvoiceDateHint(ocrPatternConfig: unknown): string | null {
  if (!ocrPatternConfig || typeof ocrPatternConfig !== "object") return null;
  const raw = (ocrPatternConfig as Record<string, unknown>).invoice_date_hint;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

function normalizeOcrDocType(value: unknown): RawOcrExtraction["doc_type"] {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (raw === "TAX_INV" || raw === "TAXINV" || raw.includes("TAX")) {
    return "TAX_INV";
  }
  if (raw === "INV_DO" || raw === "INVDO" || raw === "DO" || raw.includes("INV_DO")) {
    return "INV_DO";
  }
  if (raw === "REC" || raw === "RECEIPT" || raw === "ABB") {
    return "REC";
  }
  return "REC";
}

function normalizeOcrVatType(value: unknown): RawOcrExtraction["vat_type"] {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "INCLUSIVE" || raw === "INC" || raw.includes("INCLUSIVE")) {
    return "INCLUSIVE";
  }
  if (raw === "EXCLUSIVE" || raw === "EXC" || raw.includes("EXCLUSIVE")) {
    return "EXCLUSIVE";
  }
  if (raw === "NONE" || raw === "NO_VAT" || raw === "NOVAT") {
    return "NONE";
  }
  return "NONE";
}

/**
 * Build the strict system prompt for invoice OCR, injecting the
 * vendor-specific `ocr_pattern_config` (JSONB) as parsing hints.
 *
 * Crucial Flattening Rule: many Thai wholesale invoices lay out quantities
 * as a "Size Matrix" (one row per code/color, one column per size). Gemini
 * MUST flatten every non-zero size column into its own line, combining
 * Code + Color + Size into `raw_vendor_sku` (e.g. "EA1331-DD-S", qty 15).
 */
function buildOcrSystemPrompt(
  vendorName: string,
  ocrPatternConfig: unknown,
): string {
  const invoiceNoHint = extractInvoiceNoHint(ocrPatternConfig);
  const invoiceDateHint = extractInvoiceDateHint(ocrPatternConfig);

  return `
You are an Expert ERP OCR System specialized in reading Thai wholesale/retail clothing invoices (บิลซื้อ) from a photographed or scanned image.

Vendor: ${vendorName}
Vendor-specific layout hints (ocr_pattern_config — use these column/table rules when present, otherwise infer from the image):
${JSON.stringify(ocrPatternConfig ?? {})}

DOCUMENT NUMBER — locate the main document/invoice number printed on this receipt (commonly labeled "เลขที่", "เลขที่ใบกำกับภาษี", "เลขที่ใบส่งของ", "Invoice No.", "Doc No.", usually near the header/top of the page).
${
  invoiceNoHint
    ? `Hint for THIS vendor's layout (from invoice_no_hint): ${invoiceNoHint}`
    : "No vendor-specific invoice_no_hint is configured for this vendor — infer the document number from the image using common Thai invoice layout conventions."
}
Return it as "document_number" in the JSON response root, exactly as printed. If it is truly not visible anywhere on the page, return an empty string "" — NEVER invent or guess one.

DOCUMENT DATE — locate the main document/invoice date printed on this receipt (commonly labeled "วันที่", "ลงวันที่", "Date", usually near the document number in the header).
${
  invoiceDateHint
    ? `Hint for THIS vendor's layout (from invoice_date_hint): ${invoiceDateHint}`
    : "No vendor-specific invoice_date_hint is configured for this vendor — infer the document date from the image using common Thai invoice layout conventions."
}
Thai invoices commonly print the date in Buddhist Era (พ.ศ., e.g. "15/03/2567"). You MUST convert Buddhist Era years to the Gregorian equivalent (subtract 543) and normalize the result to ISO format "YYYY-MM-DD" (e.g. "15/03/2567" → "2024-03-15"). Return it as "document_date" in the JSON response root. If it is truly not visible anywhere on the page, or you cannot confidently parse day/month/year, return an empty string "" — NEVER invent or guess one.

DOCUMENT TYPE (doc_type) — analyze the document TITLE / header label and classify into ONE of these ERP enum values only:
- "TAX_INV" if the header says ใบกำกับภาษี / Tax Invoice / ใบกำกับภาษีอย่างย่อ
- "INV_DO" if the header says ใบส่งของ / Delivery Order / ใบส่งสินค้า
- "REC" if the header says ใบเสร็จ / ใบเสร็จรับเงิน / บิลเงินสด / ใบรับสินค้า / Cash Bill / Receipt, or when the type is unclear
Return exactly one of: "TAX_INV", "INV_DO", "REC".

VAT TYPE (vat_type) — analyze the TOTALS / summary footer (ยอดรวม, ส่วนลด, ภาษีมูลค่าเพิ่ม, ยอดสุทธิ):
- "EXCLUSIVE" if VAT 7% is ADDED separately after a net/subtotal (e.g. lines show "ภาษีมูลค่าเพิ่ม 7%" or "VAT 7%" as an added amount)
- "INCLUSIVE" if prices/totals already INCLUDE VAT (e.g. "ราคารวม VAT", "รวมภาษีแล้ว", no separate VAT add-on line but VAT is mentioned as included)
- "NONE" if there is no VAT at all (no 7%, no VAT line, cash bill without tax)
Return exactly one of: "NONE", "INCLUSIVE", "EXCLUSIVE".

CRUCIAL FLATTENING RULE — Size Matrix:
Some invoices show one product row (code + color) with MULTIPLE size columns (e.g. XS, S, M, L, XL) each holding its own quantity. You MUST flatten this into one output row PER size column that has a quantity greater than 0. Combine the product code, color, and that size into "raw_vendor_sku" as "{Code}-{Color}-{Size}".
Example: row code "EA1331", color "DD", with qty 15 under the "S" column and qty 8 under the "M" column → TWO separate output rows: {"raw_vendor_sku": "EA1331-DD-S", "qty": 15, ...} AND {"raw_vendor_sku": "EA1331-DD-M", "qty": 8, ...}. Never merge sizes into one row, and never output a row for a size column with quantity 0 or blank.

Other rules:
- Extract EVERY line item visible on the invoice — never skip rows.
- "raw_vendor_sku" = the factory/vendor product code exactly as printed, flattened per the rule above — this is Ground Truth, NEVER invent or guess an internal SKU.
- "raw_description" = short description of the item as printed (Thai or English), or "" if none.
- "discount_text" examples: "40%", "41.8%", "40+5%", "50", or "" if no discount.
- "qty" and "unit_price" MUST be plain numbers — no currency symbols, no thousands separators.
- Respond with ONLY a valid JSON OBJECT — no markdown code fences, no commentary, no trailing text — matching EXACTLY this shape:
{"document_number": "", "document_date": "", "doc_type": "REC", "vat_type": "NONE", "items": [{"raw_vendor_sku": "", "raw_description": "", "qty": 0, "unit_price": 0, "discount_text": ""}]}
`.trim();
}

/** Strip ```json fences (if any) and isolate the first JSON object in the text. */
function extractJsonObjectText(rawText: string): string {
  const cleaned = rawText
    .replace(/```json\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  const objectMatch = /\{[\s\S]*\}/.exec(cleaned);
  return objectMatch ? objectMatch[0] : cleaned;
}

/** Parse + coerce Gemini's JSON text into `RawOcrExtraction`, throws on unparsable/wrong-shape text. */
function parseOcrExtractionJson(rawText: string): RawOcrExtraction {
  const jsonSlice = extractJsonObjectText(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    throw new Error("Gemini ตอบกลับไม่เป็น JSON ที่ถูกต้อง (parse ไม่สำเร็จ)");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      'Gemini ตอบกลับไม่ใช่ JSON object ตามรูปแบบที่กำหนด ({"document_number", "items"})',
    );
  }

  const root = parsed as Record<string, unknown>;

  if (!Array.isArray(root.items)) {
    throw new Error('Gemini ตอบกลับไม่มี "items" เป็น JSON array ของรายการสินค้า');
  }

  const items: RawOcrLine[] = root.items.map((row) => {
    const item = (row ?? {}) as Record<string, unknown>;
    return {
      raw_vendor_sku: String(item.raw_vendor_sku ?? "").trim(),
      raw_description: item.raw_description
        ? String(item.raw_description).trim()
        : null,
      qty: Number(item.qty) || 0,
      unit_price: Number(item.unit_price) || 0,
      discount_text: String(item.discount_text ?? "").trim(),
    };
  });

  const documentNumber =
    typeof root.document_number === "string" ? root.document_number.trim() : "";

  const documentDate = normalizeIsoDate(
    typeof root.document_date === "string" ? root.document_date.trim() : "",
  );

  return {
    document_number: documentNumber || null,
    document_date: documentDate,
    doc_type: normalizeOcrDocType(root.doc_type),
    vat_type: normalizeOcrVatType(root.vat_type),
    items,
  };
}

/**
 * Validate/normalize Gemini's `document_date` into a strict ISO `YYYY-MM-DD`
 * string, or `null` if empty/unparsable. Gemini is instructed to already
 * convert Buddhist Era → Gregorian and format as ISO, but this guards
 * against a malformed or hallucinated value ever reaching `doc_headers`
 * (a `date` column that would otherwise throw a raw Postgres error).
 */
function normalizeIsoDate(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealCalendarDate =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;

  return isRealCalendarDate ? value : null;
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

    const vendorId = body?.vendorId as string | undefined;
    const imageBase64 = body?.imageBase64 as string | undefined;
    const mimeType = (body?.mimeType as string | undefined) || "image/jpeg";

    if (!vendorId || !imageBase64) {
      throw new Error("Missing required parameters: vendorId or imageBase64");
    }

    // 2. Initialize Supabase Admin client explicitly — service-role only,
    // this function is only ever invoked from our trusted Server Action.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl) {
      throw new Error("Missing SUPABASE_URL secret on this Edge Function");
    }
    if (!supabaseServiceRoleKey) {
      throw new Error(
        "Missing SUPABASE_SERVICE_ROLE_KEY secret on this Edge Function",
      );
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

    // 3. Initialize GoogleGenerativeAI explicitly
    const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
    if (!geminiApiKey) {
      throw new Error("Missing GEMINI_API_KEY secret on this Edge Function");
    }
    const genAI = new GoogleGenerativeAI(geminiApiKey);

    // 4. Vendor OCR pattern config — AI Pattern Memorization per vendor
    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("contacts")
      .select("company_name, ocr_pattern_config")
      .eq("id", vendorId)
      .eq("contact_type", "Vendor")
      .single();

    if (vendorError || !vendor) {
      throw new Error(
        vendorError?.message ?? "ไม่พบข้อมูลผู้จำหน่ายสำหรับอ่าน ocr_pattern_config",
      );
    }

    // 5. Gemini Vision — flatten the Size Matrix into RawOcrLine[]
    const geminiModel = Deno.env.get("GEMINI_MODEL")?.trim() || "gemini-1.5-pro-001";
    const model = genAI.getGenerativeModel({
      model: geminiModel,
      generationConfig: {
        temperature: 0.1,
        responseMimeType: "application/json",
      },
    });

    const systemPrompt = buildOcrSystemPrompt(
      vendor.company_name ?? vendorId,
      vendor.ocr_pattern_config,
    );

    const result = await model.generateContent([
      systemPrompt,
      { inlineData: { mimeType, data: imageBase64 } },
    ]);

    const rawText = result.response.text();
    if (!rawText?.trim()) {
      throw new Error("Gemini ไม่ได้ตอบข้อมูลใดๆ กลับมา (empty response)");
    }

    const extraction = parseOcrExtractionJson(rawText);

    // 6. Success — always JSON + CORS headers
    return new Response(
      JSON.stringify({
        data: extraction.items,
        document_number: extraction.document_number,
        document_date: extraction.document_date,
        doc_type: extraction.doc_type,
        vat_type: extraction.vat_type,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    // Bulletproof: log server-side, and always return valid JSON + CORS
    // headers to the client — never let a raw/opaque non-2xx leak through.
    const message = getErrorMessage(error);
    console.error("OCR Edge Function Error:", message);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
