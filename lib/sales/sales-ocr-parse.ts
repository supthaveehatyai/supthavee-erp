import type { VatCalculationType } from "@/lib/utils/document-summary";

export const SERVICE_ITEM_PATTERN =
  /ค่าบล็อก|ค่าบล็อค|ค่าสกรีน|ค่าปัก|ค่าส่ง|ค่าจัดส่ง|ค่าทำบล็อก|บล็อกสกรีน|ค่าบริการ/i;

export function normalizeSalesLabel(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("th")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180);
}

export function isServiceSalesLabel(value: string): boolean {
  return SERVICE_ITEM_PATTERN.test(value);
}

export function normalizeIsoDate(value: string): string | null {
  const raw = value.trim();
  if (!raw) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (iso) return buildIso(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const slash = /^(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})/.exec(raw);
  if (slash) {
    return buildIso(expandYear(Number(slash[3])), Number(slash[2]), Number(slash[1]));
  }

  const thai = /^(\d{1,2})\s+([^\s]+)\s+(\d{2,4})/.exec(raw);
  if (thai) {
    const month = THAI_MONTHS[thai[2].replace(/\./g, "")] ?? 0;
    if (month) return buildIso(expandYear(Number(thai[3])), month, Number(thai[1]));
  }

  return null;
}

const THAI_MONTHS: Record<string, number> = {
  มค: 1,
  มกราคม: 1,
  กพ: 2,
  กุมภาพันธ์: 2,
  มีค: 3,
  มีนาคม: 3,
  เมย: 4,
  เมษายน: 4,
  พค: 5,
  พฤษภาคม: 5,
  มิย: 6,
  มิถุนายน: 6,
  กค: 7,
  กรกฎาคม: 7,
  สค: 8,
  สิงหาคม: 8,
  กย: 9,
  กันยายน: 9,
  ตค: 10,
  ตุลาคม: 10,
  พย: 11,
  พฤศจิกายน: 11,
  ธค: 12,
  ธันวาคม: 12,
};

function expandYear(year: number): number {
  if (year >= 2400) return year - 543;
  if (year < 100) {
    // 69 = พ.ศ. 2569. Excel's yy format uses 00–39 for ค.ศ. 2000–2039.
    if (year >= 40) return 2500 + year - 543;
    return 2000 + year;
  }
  return year;
}

function buildIso(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  const real =
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day;
  if (!real) return null;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function lineAmounts(
  qty: number,
  unitPrice: number,
  discountText: string,
): { discount_amount: number; line_total: number } {
  const gross = Math.max(0, qty) * Math.max(0, unitPrice);
  const text = discountText.trim();
  let discount = 0;
  if (text.endsWith("%")) {
    const pct = Number(text.slice(0, -1).replace(/,/g, ""));
    if (Number.isFinite(pct)) discount = gross * (pct / 100);
  } else if (text) {
    const amount = Number(text.replace(/,/g, ""));
    if (Number.isFinite(amount)) discount = amount;
  }
  discount = roundMoney(Math.min(gross, Math.max(0, discount)));
  return { discount_amount: discount, line_total: roundMoney(gross - discount) };
}

export function normalizeVatType(value: unknown): VatCalculationType {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw.includes("INCLUSIVE")) return "INCLUSIVE";
  if (raw.includes("NONE") || raw.includes("NO_VAT") || raw.includes("NOVAT")) {
    return "NONE";
  }
  if (raw.includes("EXCLUSIVE")) return "EXCLUSIVE";
  return "EXCLUSIVE";
}

export function parseJsonObject(rawText: string): Record<string, unknown> {
  const cleaned = rawText.replace(/```json\s*/gi, "").replace(/```/g, "").trim();
  const objectMatch = /\{[\s\S]*\}/.exec(cleaned);
  const jsonSlice = objectMatch ? objectMatch[0] : cleaned;
  const parsed = JSON.parse(jsonSlice) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Gemini ตอบกลับไม่ใช่ JSON object");
  }
  return parsed as Record<string, unknown>;
}

export function handwrittenBillPrompt(): string {
  return `
You read a handwritten Thai store sales bill (บิลเขียนมือหน้าร้านเสื้อผ้า/สกรีน/ปัก) from a photo or PDF.
Return ONLY JSON, no markdown.
Convert every Buddhist year (พ.ศ.) to Gregorian YYYY-MM-DD by subtracting 543.
A 2-digit year such as 69 means พ.ศ. 2569, then 2569-543=2026. Never treat 69 as 1969.
handwritten_doc_ref is the book/number printed on the bill, for example "เล่มที่ 21 เลขที่ 5" or "573032". Copy it exactly. Use "" if absent.
customer_keyword is the customer name or nickname such as "พี่ก๊ก" or "พี่รัตน์". Use "" if absent.
items: every product or charge. qty and unit_price are plain numbers.
If the line is a service charge (ค่าบล็อก, ค่าสกรีน, ค่าปัก, ค่าส่ง, ค่าจัดส่ง) set is_service true.
discount_text is "10%" or "50" or "".
vat_type is EXCLUSIVE, INCLUSIVE, or NONE.
{"doc_date":"","handwritten_doc_ref":"","customer_keyword":"","notes":"","vat_type":"EXCLUSIVE","items":[{"description":"","qty":1,"uom":"ตัว","unit_price":0,"discount_text":"","is_service":false}]}
`.trim();
}

export function transferSlipPrompt(): string {
  return `
You read a Thai bank transfer slip (สลิปโอนเงิน) from a photo or PDF.
Return ONLY JSON, no markdown.
transfer_date must be Gregorian YYYY-MM-DD. If the slip shows a Buddhist year such as "02 พ.ย. 2569", subtract 543 (2569-543=2026) and return 2026-11-02.
reference_no is the slip reference or transaction id copied exactly, for example 202611022lglURDtdhTd9jfp. Use "" if absent.
amount is the transferred money as a plain number without commas. Use 0 if absent.
{"transfer_date":"","reference_no":"","amount":0}
`.trim();
}

export function ecommerceImagePrompt(channelHint: string): string {
  return `
You read a Shopee or Lazada seller screenshot, order export photo, or shipping label.
Channel hint from the file name: ${channelHint || "unknown"}.
Return ONLY JSON. sales_channel is exactly SHOPEE or LAZADA.
doc_date is Gregorian YYYY-MM-DD. Convert พ.ศ. by subtracting 543.
One object per order. Extract buyer name, order number, tracking number, and line items with qty and unit price (gross selling price, not the net after platform fee).
{"sales_channel":"SHOPEE","orders":[{"order_no":"","buyer_name":"","tracking_no":"","doc_date":"","items":[{"description":"","sku":"","qty":1,"uom":"ตัว","unit_price":0,"discount_text":"","is_service":false}]}]}
`.trim();
}
