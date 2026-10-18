/**
 * Smart Goods Receipt OCR — runs in the Next.js Server Action so Parse with AI
 * does not depend on a separately deployed Edge Function.
 */

import type { Json } from "@/src/types/supabase";
import {
  cleanGeminiModelId,
  generateGeminiContent,
  type GeminiGenerateResult,
} from "@/lib/ai/gemini-client";

export type GoodsReceiptOcrLine = {
  raw_vendor_sku: string;
  raw_description: string | null;
  qty: number;
  unit_price: number;
  discount_text: string;
};

export type GoodsReceiptOcrExtraction = {
  document_number: string | null;
  document_date: string | null;
  doc_type: "AP_TAX" | "AP_INV" | "AP_CASH";
  vat_type: "NONE" | "INCLUSIVE" | "EXCLUSIVE";
  items: GoodsReceiptOcrLine[];
  modelUsed: string;
  modelNotice: string | null;
};

function extractHint(
  ocrPatternConfig: unknown,
  key: "invoice_no_hint" | "invoice_date_hint",
): string | null {
  if (!ocrPatternConfig || typeof ocrPatternConfig !== "object") return null;
  const raw = (ocrPatternConfig as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function buildGoodsReceiptOcrPrompt(
  vendorName: string,
  ocrPatternConfig: unknown,
): string {
  const invoiceNoHint = extractHint(ocrPatternConfig, "invoice_no_hint");
  const invoiceDateHint = extractHint(ocrPatternConfig, "invoice_date_hint");

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

DOCUMENT TYPE (doc_type) — analyze the document TITLE / header label and classify into ONE of these purchase ERP enum values only:
- "AP_TAX" if the header says ใบกำกับภาษี / Tax Invoice / ใบส่งของ+ใบกำกับ (credit purchase with VAT)
- "AP_INV" if the header says ใบส่งของ / Delivery Order / บิลธรรมดา / Non-VAT invoice (credit purchase without VAT)
- "AP_CASH" if the header says บิลเงินสด / ใบเสร็จ / Cash Bill / paid immediately
Return exactly one of: "AP_TAX", "AP_INV", "AP_CASH".

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
{"document_number": "", "document_date": "", "doc_type": "AP_TAX", "vat_type": "NONE", "items": [{"raw_vendor_sku": "", "raw_description": "", "qty": 0, "unit_price": 0, "discount_text": ""}]}
`.trim();
}

function normalizeIsoDate(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
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
  return isReal ? value : null;
}

function normalizeDocType(value: unknown): GoodsReceiptOcrExtraction["doc_type"] {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (raw === "AP_TAX" || raw === "TAX_INV" || raw.includes("TAX")) return "AP_TAX";
  if (raw === "AP_CASH" || raw.includes("CASH")) return "AP_CASH";
  if (
    raw === "AP_INV" ||
    raw === "INV_DO" ||
    raw === "REC" ||
    raw.includes("INV_DO")
  ) {
    return "AP_INV";
  }
  return "AP_TAX";
}

function normalizeVatType(value: unknown): GoodsReceiptOcrExtraction["vat_type"] {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw.includes("INCLUSIVE")) return "INCLUSIVE";
  if (raw.includes("EXCLUSIVE")) return "EXCLUSIVE";
  return "NONE";
}

export function parseGoodsReceiptOcrJson(
  rawText: string,
  meta: Pick<GeminiGenerateResult, "modelUsed" | "notice">,
): GoodsReceiptOcrExtraction {
  const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const objectMatch = /\{[\s\S]*\}/.exec(cleaned);
  const jsonSlice = objectMatch ? objectMatch[0] : cleaned;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    throw new Error("Gemini ตอบกลับไม่เป็น JSON ที่ถูกต้อง (parse ไม่สำเร็จ)");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini ตอบกลับไม่ใช่ JSON object ของบิล");
  }

  const root = parsed as Record<string, unknown>;
  if (!Array.isArray(root.items)) {
    throw new Error('Gemini ตอบกลับไม่มี "items" เป็นรายการสินค้า');
  }

  const items: GoodsReceiptOcrLine[] = root.items.map((row) => {
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

  return {
    document_number: documentNumber || null,
    document_date: normalizeIsoDate(
      typeof root.document_date === "string" ? root.document_date.trim() : "",
    ),
    doc_type: normalizeDocType(root.doc_type),
    vat_type: normalizeVatType(root.vat_type),
    items,
    modelUsed: meta.modelUsed,
    modelNotice: meta.notice,
  };
}

export async function runGoodsReceiptOcr(input: {
  apiKey: string;
  preferredModel: unknown;
  vendorName: string;
  ocrPatternConfig: Json | null;
  imageBase64: string;
  mimeType: string;
}): Promise<GoodsReceiptOcrExtraction> {
  const generated = await generateGeminiContent({
    apiKey: input.apiKey,
    preferredModel: cleanGeminiModelId(input.preferredModel),
    parts: [
      {
        text: buildGoodsReceiptOcrPrompt(
          input.vendorName,
          input.ocrPatternConfig,
        ),
      },
      {
        inlineData: {
          mimeType: input.mimeType || "image/jpeg",
          data: input.imageBase64,
        },
      },
    ],
  });

  return parseGoodsReceiptOcrJson(generated.text, {
    modelUsed: generated.modelUsed,
    notice: generated.notice,
  });
}
