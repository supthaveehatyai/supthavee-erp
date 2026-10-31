import { NextResponse } from "next/server";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { generateGeminiContent, resolveGeminiApiKey } from "@/lib/ai/gemini-client";
import { OCR_MODEL_CASCADE } from "@/lib/ai/ocr-quota";
import { createClient } from "@/lib/supabase/server-admin";
import type { ExpenseOcrLine, ExpenseOcrScan } from "@/types/expense";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BUYER_TAX_ID = "0905564000520";
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

type ScanBody = {
  fileBase64?: string;
  mimeType?: string;
  fileName?: string;
};

type GeminiJson = {
  vendor_name?: unknown;
  vendor_tax_id?: unknown;
  vendor_address?: unknown;
  invoice_no?: unknown;
  reference_no?: unknown;
  expense_date?: unknown;
  description?: unknown;
  category?: unknown;
  sub_total?: unknown;
  vat_amount?: unknown;
  total_amount?: unknown;
  has_vat?: unknown;
  vehicle_plate?: unknown;
  vat_mode?: unknown;
  line_items?: unknown;
};

function text(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function money(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed * 100) / 100;
}

function digits(value: string): string {
  return value.replace(/\D/g, "");
}

function rawBase64(value: string): string {
  const comma = value.indexOf(",");
  const payload = value.startsWith("data:") && comma >= 0 ? value.slice(comma + 1) : value;
  return payload.replace(/\s/g, "");
}

async function geminiApiKey(): Promise<string> {
  const fromEnv = (
    resolveGeminiApiKey() ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    ""
  ).trim();
  if (fromEnv) return fromEnv;

  const admin = createClient();
  const { data } = await admin.from("system_settings").select("*").eq("id", 1).maybeSingle();
  const record = data as unknown as Record<string, unknown> | null;
  if (!record) return "";
  for (const [key, value] of Object.entries(record)) {
    if (!/gemini|generative/i.test(key)) continue;
    if (typeof value === "string" && value.trim().length > 20) return value.trim();
  }
  return "";
}

function promptText(): string {
  return [
    "อ่านใบเสร็จหรือใบกำกับภาษีนี้ แล้วตอบเป็น JSON เท่านั้น ไม่มี markdown",
    "โครงสร้าง:",
    '{"vendor_name":"","vendor_tax_id":"","vendor_address":"","invoice_no":"","reference_no":"","expense_date":"YYYY-MM-DD","description":"","category":"FUEL_TRANSPORT|UTILITIES|OFFICE_SUPPLIES|REPAIR_MAINTENANCE|OTHER","sub_total":0,"vat_amount":0,"total_amount":0,"has_vat":true,"vat_mode":"INCLUSIVE|EXCLUSIVE|NO_VAT","vehicle_plate":"","line_items":[{"description":"","quantity":1,"unit_name":"","unit_price":0,"line_total":0}]}',
    "กฎ:",
    `1. ห้ามใส่เลขผู้เสียภาษี ${BUYER_TAX_ID} ของบริษัท ทรัพย์ทวี หาดใหญ่ จำกัด ซึ่งเป็นผู้ซื้อ ลง vendor_tax_id ให้ใช้เลขของผู้ขายหรือปั๊มน้ำมันที่ออกบิลเท่านั้น`,
    "2. expense_date ต้องเป็น ค.ศ. รูปแบบ YYYY-MM-DD",
    "3. ถ้าบิลมีมูลค่าสินค้า ภาษีมูลค่าเพิ่ม 7% และรวมเงิน ให้ใส่ sub_total, vat_amount, total_amount ตามตัวเลขบนบิลตรง ๆ เช่น มูลค่าสินค้า 1,214.95 ภาษี 85.05 รวมเงิน 1,300.00",
    "4. category ของบิลน้ำมันคือ FUEL_TRANSPORT",
    "5. description ให้สรุปรายการและทะเบียนรถถ้ามี",
    "6. line_items ให้แยกรายการบนบิล เช่น ชื่อสินค้า จำนวน หน่วย ราคาต่อหน่วย และยอดรวมบรรทัด",
    "7. บิลที่แสดงยอดรวมเป็นราคารวมภาษี ให้ตั้ง vat_mode = INCLUSIVE",
  ].join("\n");
}

async function askGemini(apiKey: string, mimeType: string, base64: string): Promise<string> {
  const result = await generateGeminiContent({
    apiKey,
    preferredModel: OCR_MODEL_CASCADE[0],
    modelCascade: [...OCR_MODEL_CASCADE],
    parts: [
      { text: promptText() },
      { inlineData: { mimeType, data: base64 } },
    ],
  });
  return result.text;
}

function parseScan(raw: string): GeminiJson {
  const cleaned = raw
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("AI ไม่ได้คืน JSON ของใบเสร็จ");
  return JSON.parse(cleaned.slice(start, end + 1)) as GeminiJson;
}

function vatModeOf(value: unknown, hasVat: boolean): ExpenseOcrScan["vat_mode"] {
  const raw = text(value).toUpperCase();
  if (raw === "INCLUSIVE" || raw === "EXCLUSIVE" || raw === "NO_VAT") return raw;
  return hasVat ? "INCLUSIVE" : "NO_VAT";
}

function lineItemsOf(value: unknown): ExpenseOcrLine[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const item = row as Record<string, unknown>;
    const description = text(item.description);
    if (!description) return [];
    const quantity = Number(String(item.quantity ?? "1").replace(/,/g, ""));
    return [{
      description,
      quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity * 1000) / 1000 : 1,
      unit_name: text(item.unit_name) || null,
      unit_price: money(item.unit_price),
      line_total: money(item.line_total),
    }];
  });
}

const CATEGORY_NAMES: Record<string, string> = {
  FUEL_TRANSPORT: "ค่าน้ำมันเชื้อเพลิงและยานพาหนะ",
  UTILITIES: "ค่าสาธารณูปโภค",
  OFFICE_SUPPLIES: "ค่าวัสดุสิ้นเปลือง",
  REPAIR_MAINTENANCE: "ค่าซ่อมแซมและบำรุงรักษา",
  OTHER: "ค่าใช้จ่ายเบ็ดเตล็ด",
};

async function categoryForCode(code: string): Promise<{ id: string | null; name: string }> {
  const name = CATEGORY_NAMES[code] ?? CATEGORY_NAMES.OTHER;
  const admin = createClient();
  const found = await admin
    .from("mst_expense_categories")
    .select("id")
    .eq("category_name", name)
    .maybeSingle();
  if (found.data?.id) return { id: String(found.data.id), name };
  if (code !== "FUEL_TRANSPORT") {
    const travel = await admin
      .from("mst_expense_categories")
      .select("id")
      .eq("category_name", "ค่าขนส่งและเดินทาง")
      .maybeSingle();
    return {
      id: travel.data?.id ? String(travel.data.id) : null,
      name: "ค่าขนส่งและเดินทาง",
    };
  }
  const inserted = await admin
    .from("mst_expense_categories")
    .insert({ category_name: name, is_active: true })
    .select("id")
    .single();
  return {
    id: inserted.data?.id ? String(inserted.data.id) : null,
    name,
  };
}

async function matchOrCreateContact(
  vendorName: string,
  vendorTaxId: string,
  vendorAddress: string,
): Promise<string | null> {
  const admin = createClient();
  if (vendorTaxId.length === 13) {
    const byTax = await admin
      .from("contacts")
      .select("id")
      .eq("tax_id", vendorTaxId)
      .limit(1)
      .maybeSingle();
    if (byTax.data?.id) return String(byTax.data.id);
  }
  if (vendorName) {
    const byName = await admin
      .from("contacts")
      .select("id")
      .ilike("company_name", vendorName)
      .limit(1)
      .maybeSingle();
    if (byName.data?.id) return String(byName.data.id);
  }
  if (vendorTaxId.length !== 13 || !vendorName) return null;
  const inserted = await admin
    .from("contacts")
    .insert({
      company_name: vendorName,
      tax_id: vendorTaxId,
      address: vendorAddress || null,
      tax_address: vendorAddress || null,
      contact_roles: ["Vendor"],
      customer_type: "นิติบุคคล",
      entity_type: "CORPORATE",
      branch_code: "สำนักงานใหญ่",
      default_price_tier: "Wholesale",
      credit_days: 0,
      is_active: true,
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    console.error("[expense-ocr] create contact:", inserted.error?.message);
    return null;
  }
  return String(inserted.data.id);
}

export async function POST(request: Request) {
  const user = await getCurrentAuthUser();
  if (!user?.userId) {
    return NextResponse.json({ success: false, error: "กรุณาเข้าสู่ระบบก่อนสแกนบิล" }, { status: 401 });
  }

  let body: ScanBody;
  try {
    body = (await request.json()) as ScanBody;
  } catch {
    return NextResponse.json({ success: false, error: "ข้อมูลไฟล์ไม่ถูกต้อง" }, { status: 400 });
  }

  const mimeType = text(body.mimeType).toLowerCase();
  const base64 = rawBase64(text(body.fileBase64));
  if (!ALLOWED_MIME.has(mimeType) || !base64) {
    return NextResponse.json(
      { success: false, error: "รองรับเฉพาะ JPG, PNG, WEBP และ PDF" },
      { status: 400 },
    );
  }

  const apiKey = await geminiApiKey();
  if (!apiKey) {
    return NextResponse.json(
      { success: false, error: "ไม่พบ GEMINI_API_KEY สำหรับสแกนบิล" },
      { status: 500 },
    );
  }

  try {
    const admin = createClient();
    const now = new Date();
    const ext = mimeType === "application/pdf" ? "pdf" : "jpg";
    const safeStoragePath = `expenses/${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}/exp-${Date.now()}.${ext}`;
    const buffer = Buffer.from(base64, "base64");
    if (buffer.length < 32 || buffer.length > 12 * 1024 * 1024) {
      return NextResponse.json({ success: false, error: "ไฟล์บิลว่างหรือใหญ่เกิน 12 MB" }, { status: 400 });
    }
    const uploaded = await admin.storage.from("document_attachments").upload(safeStoragePath, buffer, {
      contentType: mimeType,
      upsert: false,
    });
    if (uploaded.error) {
      return NextResponse.json({ success: false, error: uploaded.error.message }, { status: 500 });
    }
    const attachmentUrl = admin.storage.from("document_attachments").getPublicUrl(safeStoragePath).data.publicUrl;

    const answer = await askGemini(apiKey, mimeType, base64);
    const parsed = parseScan(answer);
    let vendorTaxId = digits(text(parsed.vendor_tax_id));
    if (vendorTaxId === BUYER_TAX_ID) vendorTaxId = "";
    const vendorName = text(parsed.vendor_name);
    const vendorAddress = text(parsed.vendor_address);
    const expenseDate = /^\d{4}-\d{2}-\d{2}$/.test(text(parsed.expense_date))
      ? text(parsed.expense_date)
      : null;
    const contactId = await matchOrCreateContact(vendorName, vendorTaxId, vendorAddress);
    const scannedText = [
      text(parsed.description),
      text(parsed.category),
      ...lineItemsOf(parsed.line_items).map((line) => line.description),
    ].join(" ");
    const categoryCode = /แก๊สโซฮอล์|gasohol|น้ำมันเชื้อเพลิง|ดีเซล|diesel|\be20\b/i.test(scannedText)
      ? "FUEL_TRANSPORT"
      : text(parsed.category).toUpperCase() || "OTHER";
    const category = await categoryForCode(categoryCode);
    const vatAmount = money(parsed.vat_amount);
    const hasVat = parsed.has_vat === true || vatAmount > 0;
    const mode = vatModeOf(parsed.vat_mode, hasVat);
    const data: ExpenseOcrScan = {
      vendor_name: vendorName || null,
      vendor_tax_id: vendorTaxId || null,
      vendor_address: vendorAddress || null,
      invoice_no: text(parsed.invoice_no) || null,
      reference_no: text(parsed.reference_no) || null,
      expense_date: expenseDate,
      description: text(parsed.description) || null,
      category: categoryCode,
      category_id: category.id,
      category_name: category.name,
      sub_total: money(parsed.sub_total),
      vat_amount: vatAmount,
      total_amount: money(parsed.total_amount),
      has_vat: hasVat,
      vat_mode: mode,
      accounting_tax_tier: mode === "NO_VAT" || vendorTaxId.length !== 13 ? "INTERNAL_1_3" : "CORP_VAT",
      vehicle_plate: text(parsed.vehicle_plate) || null,
      contact_id: contactId,
      attachment_url: attachmentUrl,
      line_items: lineItemsOf(parsed.line_items),
    };
    return NextResponse.json({ success: true, data });
  } catch (error) {
    const message = error instanceof Error ? error.message : "สแกนบิลไม่สำเร็จ";
    console.error("[expense-ocr]", message);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
