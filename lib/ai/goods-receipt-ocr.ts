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
import { splitOriginFreightLines } from "@/lib/utils/dual-freight";

export type GoodsReceiptOcrLine = {
  raw_vendor_sku: string;
  raw_description: string | null;
  qty: number;
  unit_price: number;
  discount_text: string;
  purchase_uom_code?: string | null;
  conversion_factor?: number | null;
};

export type GoodsReceiptOcrExtraction = {
  document_number: string | null;
  document_date: string | null;
  doc_type: "AP_TAX" | "AP_INV" | "AP_CASH";
  vat_type: "NONE" | "INCLUSIVE" | "EXCLUSIVE";
  /** Origin freight pulled out of product lines (ค่าส่ง / ค่าขนส่ง). */
  freight_cost: number;
  /** Printed amount after discount and before VAT. Null when the paper has no such figure. */
  subtotal: number | null;
  /** Printed payable total (ยอดสุทธิ). Null when it cannot be read. */
  grand_total: number | null;
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
Thai invoices commonly print the date in Buddhist Era (พ.ศ.). Convert EVERY Buddhist year to Gregorian by subtracting 543, then return ISO "YYYY-MM-DD".
- 4-digit พ.ศ. such as "24 ส.ค. 2569" or "24/08/2569" → 2569 - 543 = 2026 → "2026-08-24".
- 2-digit พ.ศ. such as "11/8/69" means year 2569 (2500 + 69), then 2569 - 543 = 2026 → "2026-08-11". Never treat "69" as 1969 or 2069.
Return it as "document_date". If it is not visible or you cannot parse day/month/year, return "" — NEVER invent a date.

MULTI-PAGE: when several images are attached they are consecutive pages of ONE invoice (e.g. หน้า 1/2 and 2/2). Extract each product line ONCE. Do not duplicate a line that continues onto the next page. The printed grand total appears once — do not add page subtotals into a second grand total.
CRITICAL RULE FOR PAGE BREAKS: ในบิลที่มีหลายหน้า บรรทัดสุดท้ายของหน้าแรกมักมีคำว่า 'ต่อหน้าถัด' หรือ 'ต่อหน้าถัดไป' พิมพ์ทับซ้อนอยู่ตรงชื่อไซส์หรือรายการสินค้า ห้ามข้ามบรรทัดนั้นเด็ดขาด! ให้สกัดรายการสินค้านั้นออกมาเป็น line item ตามปกติ (ตัดคำว่า 'ต่อหน้าถัด' ออก และเดาไซส์จากบริบทหรือเว้นไว้ให้ผู้ใช้แก้) และนับจำนวนบรรทัดรวมทุกหน้าให้ครบถ้วนตรงตามเลขลำดับ No. ในบิล

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
- "qty" and "unit_price" MUST be plain numbers — no currency symbols, no thousands separators. Keep up to 4 decimal places when the paper prints them (185.9813). "qty" is the quantity printed in the purchase unit (5 โหล → qty 5, not 60).
- "subtotal" = the printed amount AFTER the bill discount and BEFORE VAT (ฐานภาษี / ยอดหลังส่วนลด). Copy the printed number. Use 0 if that figure is not printed.
- "grand_total" = the printed payable total (ยอดสุทธิ / รวมทั้งสิ้น / Grand Total). Copy the printed number. Use 0 if it is not printed. Do not calculate it from the lines.
- PURCHASE UOM: if the quantity cell ends with "ล" or "โหล" (dozen), set "purchase_uom_code" to "DZN" and "conversion_factor" to 12. Otherwise set "purchase_uom_code" to "PCS" and "conversion_factor" to 1.
- ORIGIN FREIGHT: a line whose description or code is a delivery charge (ค่าส่ง, ค่าขนส่ง, ค่าจัดส่ง, "ค่าส่ง รวมกับบิลแรก", freight) is NOT a product. Do NOT put it in "items". Sum those amounts into root "freight_cost". Example: code 34223, description ค่าส่ง, amount 70 → freight_cost 70 and no item row, so received quantity is not inflated.
- Respond with ONLY a valid JSON OBJECT — no markdown code fences, no commentary, no trailing text — matching EXACTLY this shape:
{"document_number": "", "document_date": "", "doc_type": "AP_TAX", "vat_type": "NONE", "freight_cost": 0, "subtotal": 0, "grand_total": 0, "items": [{"raw_vendor_sku": "", "raw_description": "", "qty": 0, "unit_price": 0, "discount_text": "", "purchase_uom_code": "PCS", "conversion_factor": 1}]}
`.trim();
}

function normalizeIsoDate(value: string): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  let year = Number(match[1]);
  if (year >= 2400) year -= 543;
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  const isReal =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!isReal) return null;
  const isoYear = String(year).padStart(4, "0");
  return `${isoYear}-${match[2]}-${match[3]}`;
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
      purchase_uom_code: normalizePurchaseUomCode(item.purchase_uom_code),
      conversion_factor: normalizeOcrConversionFactor(
        item.purchase_uom_code,
        item.conversion_factor,
      ),
    };
  });

  const documentNumber =
    typeof root.document_number === "string" ? root.document_number.trim() : "";
  const headerFreight = Number(root.freight_cost);
  const subtotal = Number(root.subtotal);
  const grandTotal = Number(root.grand_total);
  const split = splitOriginFreightLines(
    items,
    Number.isFinite(headerFreight) ? headerFreight : 0,
  );

  return {
    document_number: documentNumber || null,
    document_date: normalizeIsoDate(
      typeof root.document_date === "string" ? root.document_date.trim() : "",
    ),
    doc_type: normalizeDocType(root.doc_type),
    vat_type: normalizeVatType(root.vat_type),
    freight_cost: split.freightCost,
    subtotal: Number.isFinite(subtotal) && subtotal > 0 ? subtotal : null,
    grand_total: Number.isFinite(grandTotal) && grandTotal > 0 ? grandTotal : null,
    items: split.items,
    modelUsed: meta.modelUsed,
    modelNotice: meta.notice,
  };
}

function normalizePurchaseUomCode(value: unknown): string {
  const code = String(value ?? "").trim().toUpperCase();
  return code || "PCS";
}

function normalizeOcrConversionFactor(uomCode: unknown, value: unknown): number {
  if (normalizePurchaseUomCode(uomCode) === "DZN") {
    const n = Number(value);
    return Number.isFinite(n) && n > 1 ? n : 12;
  }
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

export async function runGoodsReceiptOcr(input: {
  apiKey: string;
  preferredModel: unknown;
  vendorName: string;
  ocrPatternConfig: Json | null;
  images: { imageBase64: string; mimeType: string }[];
  modelCascade?: string[] | null;
  skipModels?: string[] | null;
  onModelOutcome?: (outcome: { model: string; exhausted: boolean }) => Promise<void>;
}): Promise<GoodsReceiptOcrExtraction> {
  const images = input.images.filter((image) => image.imageBase64.trim());
  const generated = await generateGeminiContent({
    apiKey: input.apiKey,
    preferredModel: cleanGeminiModelId(input.preferredModel),
    modelCascade: input.modelCascade,
    skipModels: input.skipModels,
    onModelOutcome: input.onModelOutcome,
    parts: [
      {
        text: buildGoodsReceiptOcrPrompt(
          input.vendorName,
          input.ocrPatternConfig,
        ),
      },
      ...images.map((image) => ({
        inlineData: {
          mimeType: image.mimeType || "image/jpeg",
          data: image.imageBase64,
        },
      })),
    ],
  });

  return parseGoodsReceiptOcrJson(generated.text, {
    modelUsed: generated.modelUsed,
    notice: generated.notice,
  });
}
