"use server";

/**
 * Phase 24.2 — handwritten bill OCR and Shopee/Lazada order import.
 * This file exports async functions only.
 */

import { createDraftDocument, issueDocument, searchProductsForSales } from "@/lib/actions/document-actions";
import {
  cleanGeminiModelId,
  generateGeminiContent,
  GeminiQuotaExhaustedError,
  resolveGeminiApiKey,
} from "@/lib/ai/gemini-client";
import {
  modelsAtQuota,
  parseModelCascadeOrder,
  recordOcrQuota,
} from "@/lib/ai/ocr-quota";
import {
  detectChannelFromName,
  parseEcommerceSpreadsheet,
  type SheetOrder,
  type SheetOrderLine,
} from "@/lib/sales/ecommerce-sheet";
import {
  ecommerceImagePrompt,
  handwrittenBillPrompt,
  transferSlipPrompt,
  isServiceSalesLabel,
  lineAmounts,
  normalizeIsoDate,
  normalizeSalesLabel,
  normalizeVatType,
  parseJsonObject,
} from "@/lib/sales/sales-ocr-parse";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import type {
  EcommerceChannel,
  EcommerceOrderDraft,
  HandwrittenBillScan,
  IssueEcommerceOrdersResult,
  PreviewEcommerceOrdersResult,
  ScanHandwrittenBillResult,
  ScannedSalesLine,
} from "@/types/sales-ocr";

const ALLOWED_BILL_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_AUTO_ISSUE = 40;

type MappingHit = {
  product_id: string | null;
  is_service_item: boolean;
  sku: string | null;
  description: string | null;
  uom_used: string | null;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeOr(value: string): string {
  return value.replace(/[%_,()"\\]/g, " ").replace(/\s+/g, " ").trim();
}

async function readGeminiText(
  prompt: string,
  file: File,
  mimeType: string,
): Promise<{ text: string; modelUsed: string } | { error: string }> {
  const apiKey = resolveGeminiApiKey();
  if (!apiKey) return { error: "ไม่พบ GEMINI_API_KEY บนเซิร์ฟเวอร์" };

  const supabase = createSupabaseServerClient();
  const { data: paramRow } = await supabase
    .from("system_parameters")
    .select("param_value")
    .eq("param_key", "GEMINI_MODEL_VERSION")
    .maybeSingle();
  const { data: cascadeRow } = await supabase
    .from("system_parameters")
    .select("param_value")
    .eq("param_key", "model_cascade_order")
    .maybeSingle();

  const quotaClient = supabase as unknown as Parameters<typeof recordOcrQuota>[0];
  const quotaSnapshot = await recordOcrQuota(quotaClient, null, false);
  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  try {
    const generated = await generateGeminiContent({
      apiKey,
      preferredModel:
        cleanGeminiModelId(paramRow?.param_value) || "gemini-3.7-flash",
      modelCascade: parseModelCascadeOrder(cascadeRow?.param_value),
      skipModels: modelsAtQuota(quotaSnapshot),
      parts: [
        { text: prompt },
        { inlineData: { mimeType, data: base64 } },
      ],
      onModelOutcome: async ({ model, exhausted }) => {
        await recordOcrQuota(quotaClient, model, exhausted);
      },
    });
    return { text: generated.text, modelUsed: generated.modelUsed };
  } catch (error) {
    if (error instanceof GeminiQuotaExhaustedError) {
      return { error: error.message };
    }
    return {
      error: error instanceof Error ? error.message : "เรียก Gemini ไม่สำเร็จ",
    };
  }
}

function readMapping(row: Record<string, unknown> | null): MappingHit | null {
  if (!row) return null;
  const productId = String(row.product_id ?? "").trim();
  return {
    product_id: productId || null,
    is_service_item: row.is_service_item === true || !productId,
    sku: String(row.sku ?? row.mapped_sku ?? "").trim() || null,
    description: String(row.description ?? row.item_description ?? "").trim() || null,
    uom_used: String(row.uom_used ?? row.uom ?? "").trim() || null,
  };
}

async function findMapping(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  normalized: string,
): Promise<MappingHit | null> {
  if (!normalized) return null;
  for (const column of ["normalized_text", "source_text", "raw_text"]) {
    const { data, error } = await supabase
      .from("sales_item_mappings")
      .select("*")
      .eq(column, normalized)
      .limit(1)
      .maybeSingle();
    if (!error) return readMapping((data ?? null) as Record<string, unknown> | null);
    if (/Could not find the table|PGRST205|does not exist/i.test(error.message)) {
      return null;
    }
    if (!/column|schema cache|42703|PGRST204/i.test(error.message)) return null;
  }
  return null;
}

async function rememberMapping(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  input: {
    source: string;
    normalized: string;
    line: ScannedSalesLine;
  },
): Promise<void> {
  let payload: Record<string, unknown> = {
    source_text: input.source.slice(0, 255),
    normalized_text: input.normalized,
    raw_text: input.source.slice(0, 255),
    product_id: input.line.product_id,
    is_service_item: input.line.is_service_item,
    sku: input.line.sku,
    description: input.line.description.slice(0, 255),
    item_description: input.line.description.slice(0, 255),
    uom_used: input.line.uom_used,
  };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const { error } = await supabase.from("sales_item_mappings").insert(payload);
    if (!error || error.code === "23505") return;
    const missing = /Could not find the '([^']+)' column/i.exec(error.message);
    if (missing && missing[1] in payload) {
      delete payload[missing[1]];
      payload = { ...payload };
      continue;
    }
    return;
  }
}

async function loadProduct(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  productId: string,
): Promise<ScannedSalesLine | null> {
  const { data, error } = await supabase
    .from("products")
    .select(
      "id, sku, name, retail_price, cost_price, base_uom, product_models(image_url, is_service)",
    )
    .eq("id", productId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  const model = Array.isArray(data.product_models)
    ? data.product_models[0]
    : data.product_models;
  const unitPrice = Number(data.retail_price ?? 0);
  const money = lineAmounts(1, unitPrice, "");
  return {
    product_id: data.id,
    sku: String(data.sku ?? ""),
    description: String(data.name ?? ""),
    qty: 1,
    uom_used: String(data.base_uom ?? "ตัว"),
    unit_price: unitPrice,
    cost_price: Number(data.cost_price ?? 0),
    discount_text: "",
    discount_amount: 0,
    line_total: money.line_total,
    is_service_item: model?.is_service === true,
    image_url: model?.image_url?.trim() || null,
    match_note: "จับคู่จากรายการที่จำไว้",
  };
}

async function resolvePrintedLine(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  raw: {
    description: string;
    sku?: string;
    qty: number;
    uom?: string;
    unit_price: number;
    discount_text?: string;
    is_service?: boolean;
  },
  warnings: string[],
): Promise<ScannedSalesLine> {
  const description = raw.description.trim();
  const printedSku = raw.sku?.trim() ?? "";
  const label = description || printedSku;
  const qty = raw.qty > 0 ? raw.qty : 1;
  const unitPrice = raw.unit_price >= 0 ? raw.unit_price : 0;
  const discountText = raw.discount_text?.trim() ?? "";
  const money = lineAmounts(qty, unitPrice, discountText);
  const service =
    raw.is_service === true || isServiceSalesLabel(label);

  const base: ScannedSalesLine = {
    product_id: null,
    sku: "SERVICE",
    description: label,
    qty,
    uom_used: raw.uom?.trim() || (service ? "งาน" : "ตัว"),
    unit_price: unitPrice,
    cost_price: 0,
    discount_text: discountText,
    discount_amount: money.discount_amount,
    line_total: money.line_total,
    is_service_item: true,
    image_url: null,
    match_note: service ? "รายการบริการ" : null,
  };

  if (service) {
    await rememberMapping(supabase, {
      source: label,
      normalized: normalizeSalesLabel(label),
      line: base,
    });
    return base;
  }

  const normalized = normalizeSalesLabel(printedSku || label);
  const mapped = await findMapping(supabase, normalized);
  if (mapped?.is_service_item) {
    return { ...base, match_note: "จำไว้ว่าเป็นรายการบริการ" };
  }
  if (mapped?.product_id) {
    const product = await loadProduct(supabase, mapped.product_id);
    if (product) {
      const priced = lineAmounts(qty, unitPrice || product.unit_price, discountText);
      return {
        ...product,
        description: description || product.description,
        qty,
        uom_used: raw.uom?.trim() || mapped.uom_used || product.uom_used,
        unit_price: unitPrice || product.unit_price,
        discount_text: discountText,
        discount_amount: priced.discount_amount,
        line_total: priced.line_total,
      };
    }
  }

  const lookup = printedSku || label;
  const found = lookup ? await searchProductsForSales(lookup) : { data: [], error: null };
  const exact = found.data.find(
    (row) => row.sku.toLocaleLowerCase("en") === lookup.toLocaleLowerCase("en"),
  );
  const chosen = exact ?? (found.data.length === 1 ? found.data[0] : null);
  if (!chosen) {
    warnings.push(`ไม่พบ SKU สำหรับ "${label}" — ใส่เป็นรายการให้ตรวจเอง`);
    return { ...base, match_note: "ยังไม่จับคู่ SKU" };
  }

  const priced = lineAmounts(qty, unitPrice || chosen.unit_price, discountText);
  const matched: ScannedSalesLine = {
    product_id: chosen.id,
    sku: chosen.sku,
    description: description || chosen.display_name,
    qty,
    uom_used: raw.uom?.trim() || chosen.base_uom || "ตัว",
    unit_price: unitPrice || chosen.unit_price,
    cost_price: chosen.cost_price,
    discount_text: discountText,
    discount_amount: priced.discount_amount,
    line_total: priced.line_total,
    is_service_item: chosen.is_service === true,
    image_url: chosen.image_url,
    match_note: exact ? `ตรงรหัส ${chosen.sku}` : `จับคู่ ${chosen.sku}`,
  };
  await rememberMapping(supabase, {
    source: label,
    normalized,
    line: matched,
  });
  return matched;
}

async function matchCustomer(
  supabase: ReturnType<typeof createSupabaseServerClient>,
  keyword: string,
): Promise<{ id: string; label: string } | null | "ambiguous"> {
  const safe = escapeOr(keyword);
  if (safe.length < 1) return null;
  const { data, error } = await supabase
    .from("contacts")
    .select("id, company_name, nickname")
    .contains("contact_roles", ["Customer"])
    .eq("is_active", true)
    .or(`nickname.ilike.%${safe}%,company_name.ilike.%${safe}%`)
    .limit(8);
  if (error || !data?.length) return null;
  const needle = keyword.trim().toLocaleLowerCase("th");
  const exactNickname = data.find(
    (row) => (row.nickname ?? "").trim().toLocaleLowerCase("th") === needle,
  );
  const exactCompany = data.find(
    (row) => row.company_name.trim().toLocaleLowerCase("th") === needle,
  );
  const picked = exactNickname ?? exactCompany ?? (data.length === 1 ? data[0] : null);
  if (!picked) return data.length > 1 ? "ambiguous" : null;
  const nickname = picked.nickname?.trim();
  return {
    id: picked.id,
    label: nickname ? `${nickname} — ${picked.company_name}` : picked.company_name,
  };
}

export async function scanHandwrittenSalesBill(
  formData: FormData,
): Promise<ScanHandwrittenBillResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return { data: null, error: "ไม่พบไฟล์บิลเขียนมือ" };
    }
    if (file.size > MAX_BYTES) {
      return { data: null, error: "ไฟล์ใหญ่เกิน 8 MB" };
    }
    const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "");
    if (!ALLOWED_BILL_MIME.has(mime)) {
      return { data: null, error: "รองรับเฉพาะ JPG, PNG, WEBP และ PDF" };
    }

    const gemini = await readGeminiText(handwrittenBillPrompt(), file, mime);
    if ("error" in gemini) return { data: null, error: gemini.error };

    let root: Record<string, unknown>;
    try {
      root = parseJsonObject(gemini.text);
    } catch (error) {
      return {
        data: null,
        error: error instanceof Error ? error.message : "อ่านผล OCR ไม่สำเร็จ",
      };
    }

    const warnings: string[] = [];
    const supabase = createSupabaseServerClient();
    const rawItems = Array.isArray(root.items) ? root.items : [];
    const items: ScannedSalesLine[] = [];
    for (const row of rawItems) {
      const item = (row ?? {}) as Record<string, unknown>;
      const description = String(item.description ?? item.name ?? "").trim();
      if (!description) continue;
      items.push(
        await resolvePrintedLine(
          supabase,
          {
            description,
            sku: String(item.sku ?? ""),
            qty: Number(item.qty) || 0,
            uom: String(item.uom ?? item.uom_used ?? ""),
            unit_price: Number(item.unit_price) || 0,
            discount_text: String(item.discount_text ?? ""),
            is_service: item.is_service === true,
          },
          warnings,
        ),
      );
    }
    if (items.length === 0) {
      return { data: null, error: "ไม่พบรายการสินค้าบนบิลเขียนมือ" };
    }

    const keyword = String(root.customer_keyword ?? "").trim();
    const customer = keyword ? await matchCustomer(supabase, keyword) : null;
    if (customer === "ambiguous") {
      warnings.push(`พบลูกค้าหลายรายที่ตรงกับ "${keyword}" — กรุณาเลือกเอง`);
    } else if (keyword && !customer) {
      warnings.push(`ไม่พบลูกค้าที่ตรงกับ "${keyword}" — กรุณาเลือกเอง`);
    }
    const matchedCustomer = customer && customer !== "ambiguous" ? customer : null;

    const scan: HandwrittenBillScan = {
      doc_date: normalizeIsoDate(String(root.doc_date ?? "")),
      handwritten_doc_ref: String(root.handwritten_doc_ref ?? "").trim() || null,
      customer_keyword: keyword || null,
      contact_id: matchedCustomer?.id ?? null,
      customer_label: matchedCustomer?.label ?? null,
      notes: String(root.notes ?? "").trim() || null,
      vat_type: normalizeVatType(root.vat_type),
      items,
      model_used: gemini.modelUsed,
      warnings,
    };
    return { data: scan, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "สแกนบิลเขียนมือไม่สำเร็จ",
    };
  }
}

async function ordersFromImage(
  file: File,
  channelHint: EcommerceChannel | null,
): Promise<{ orders: SheetOrder[]; channel: EcommerceChannel | null; error: string | null }> {
  const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
  const gemini = await readGeminiText(
    ecommerceImagePrompt(channelHint ?? detectChannelFromName(file.name) ?? ""),
    file,
    mime,
  );
  if ("error" in gemini) return { orders: [], channel: channelHint, error: gemini.error };
  let root: Record<string, unknown>;
  try {
    root = parseJsonObject(gemini.text);
  } catch (error) {
    return {
      orders: [],
      channel: channelHint,
      error: error instanceof Error ? error.message : "อ่านผล OCR ไม่สำเร็จ",
    };
  }
  const channelRaw = String(root.sales_channel ?? channelHint ?? "").toUpperCase();
  const channel: EcommerceChannel | null =
    channelRaw === "LAZADA" ? "LAZADA" : channelRaw === "SHOPEE" ? "SHOPEE" : channelHint;
  const rows = Array.isArray(root.orders) ? root.orders : [];
  const orders: SheetOrder[] = [];
  for (const row of rows) {
    const order = (row ?? {}) as Record<string, unknown>;
    const orderNo = String(order.order_no ?? order.ecommerce_order_no ?? "").trim();
    if (!orderNo || !channel) continue;
    const rawItems = Array.isArray(order.items) ? order.items : [];
    const items: SheetOrderLine[] = rawItems.flatMap((itemRow) => {
      const item = (itemRow ?? {}) as Record<string, unknown>;
      const description = String(item.description ?? item.sku ?? "").trim();
      if (!description) return [];
      return [
        {
          description,
          sku: String(item.sku ?? ""),
          qty: Number(item.qty) || 1,
          uom: String(item.uom ?? "ตัว"),
          unit_price: Number(item.unit_price) || 0,
          discount_text: String(item.discount_text ?? ""),
        },
      ];
    });
    orders.push({
      sales_channel: channel,
      ecommerce_order_no: orderNo,
      ecommerce_buyer_name: String(order.buyer_name ?? "").trim() || null,
      tracking_no: String(order.tracking_no ?? "").trim() || null,
      doc_date: normalizeIsoDate(String(order.doc_date ?? "")),
      items,
    });
  }
  return { orders, channel, error: orders.length ? null : "ไม่พบเลขคำสั่งซื้อในไฟล์" };
}

async function findDuplicateDocNos(
  orders: { sales_channel: EcommerceChannel; ecommerce_order_no: string }[],
): Promise<Map<string, string>> {
  const supabase = createSupabaseServerClient();
  const duplicateByKey = new Map<string, string>();
  const byChannel = new Map<EcommerceChannel, string[]>();
  for (const order of orders) {
    const list = byChannel.get(order.sales_channel) ?? [];
    list.push(order.ecommerce_order_no);
    byChannel.set(order.sales_channel, list);
  }

  for (const [channel, numbers] of byChannel) {
    const unique = [...new Set(numbers.filter((value) => value.trim()))];
    for (let index = 0; index < unique.length; index += 40) {
      const slice = unique.slice(index, index + 40);
      const { data, error } = await supabase
        .from("documents")
        .select("doc_no, ecommerce_order_no, status")
        .eq("sales_channel", channel)
        .in("ecommerce_order_no", slice)
        .limit(200);
      if (error) continue;
      for (const row of data ?? []) {
        const status = String(row.status ?? "").toUpperCase();
        if (status === "VOID" || status === "CANCELLED") continue;
        const key = `${channel}:${String(row.ecommerce_order_no ?? "")}`;
        if (!duplicateByKey.has(key)) duplicateByKey.set(key, String(row.doc_no ?? ""));
      }
    }
  }
  return duplicateByKey;
}

async function markDuplicates(
  orders: SheetOrder[],
): Promise<EcommerceOrderDraft[]> {
  const supabase = createSupabaseServerClient();
  const warnings: string[] = [];
  const drafts: EcommerceOrderDraft[] = [];
  const duplicateByKey = await findDuplicateDocNos(orders);

  for (const order of orders) {
    const items: ScannedSalesLine[] = [];
    for (const line of order.items) {
      items.push(
        await resolvePrintedLine(
          supabase,
          {
            description: line.description,
            sku: line.sku,
            qty: line.qty,
            uom: line.uom,
            unit_price: line.unit_price,
            discount_text: line.discount_text,
          },
          warnings,
        ),
      );
    }
    drafts.push({
      sales_channel: order.sales_channel,
      ecommerce_order_no: order.ecommerce_order_no,
      ecommerce_buyer_name: order.ecommerce_buyer_name,
      tracking_no: order.tracking_no,
      doc_date: order.doc_date || todayIso(),
      items,
      duplicate_doc_no:
        duplicateByKey.get(`${order.sales_channel}:${order.ecommerce_order_no}`) ?? null,
    });
  }
  return drafts;
}

export async function previewEcommerceOrders(
  formData: FormData,
): Promise<PreviewEcommerceOrdersResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error, detected_channel: null };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return { data: null, error: "ไม่พบไฟล์ออเดอร์", detected_channel: null };
    }
    if (file.size > MAX_BYTES) {
      return { data: null, error: "ไฟล์ใหญ่เกิน 8 MB", detected_channel: null };
    }

    const hintRaw = String(formData.get("channel") ?? "").toUpperCase();
    const hint: EcommerceChannel | null =
      hintRaw === "SHOPEE" || hintRaw === "LAZADA" ? hintRaw : null;
    const lower = file.name.toLocaleLowerCase("en");
    const isSheet = lower.endsWith(".xlsx") || lower.endsWith(".csv");
    const isImage =
      ALLOWED_BILL_MIME.has(file.type) ||
      /\.(jpg|jpeg|png|webp|pdf)$/i.test(file.name);

    let parsed: { orders: SheetOrder[]; channel: EcommerceChannel | null; error: string | null };
    if (isSheet) {
      const sheet = await parseEcommerceSpreadsheet(file);
      parsed = {
        orders: sheet.orders.map((order) => ({
          ...order,
          sales_channel: hint ?? sheet.channel ?? order.sales_channel,
        })),
        channel: hint ?? sheet.channel,
        error: sheet.error,
      };
    } else if (isImage) {
      parsed = await ordersFromImage(file, hint);
    } else {
      return {
        data: null,
        error: "รองรับ Excel, CSV, JPG, PNG, WEBP และ PDF",
        detected_channel: null,
      };
    }

    if (parsed.error && parsed.orders.length === 0) {
      return { data: null, error: parsed.error, detected_channel: parsed.channel };
    }
    const channel = parsed.channel;
    if (!channel) {
      return {
        data: null,
        error: "ระบุช่องทาง Shopee หรือ Lazada ก่อนนำเข้า",
        detected_channel: null,
      };
    }

    const drafts = await markDuplicates(
      parsed.orders.map((order) => ({ ...order, sales_channel: channel })),
    );
    return { data: drafts, error: null, detected_channel: parsed.channel };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "นำเข้าออเดอร์ไม่สำเร็จ",
      detected_channel: null,
    };
  }
}

export async function issueImportedEcommerceOrders(
  orders: EcommerceOrderDraft[],
): Promise<IssueEcommerceOrdersResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };
    if (!Array.isArray(orders) || orders.length === 0) {
      return { data: null, error: "ไม่มีออเดอร์ให้สร้างบิล" };
    }
    if (orders.length > MAX_AUTO_ISSUE) {
      return { data: null, error: `ออกบิลอัตโนมัติได้ครั้งละไม่เกิน ${MAX_AUTO_ISSUE} ออเดอร์` };
    }

    const duplicates = await findDuplicateDocNos(orders);
    const freshByNo = new Map(
      orders.map((order) => [
        order.ecommerce_order_no,
        duplicates.get(`${order.sales_channel}:${order.ecommerce_order_no}`) ?? null,
      ]),
    );

    const issued: { order_no: string; doc_no: string }[] = [];
    const skipped: string[] = [];
    const failed: { order_no: string; error: string }[] = [];

    for (const order of orders) {
      const duplicateDocNo = freshByNo.get(order.ecommerce_order_no);
      if (duplicateDocNo) {
        skipped.push(`${order.ecommerce_order_no} (${duplicateDocNo})`);
        continue;
      }
      if (order.items.length === 0) {
        failed.push({ order_no: order.ecommerce_order_no, error: "ไม่มีรายการสินค้า" });
        continue;
      }

      const draft = await createDraftDocument({
        doc_type: "ABB",
        contact_id: null,
        doc_date: order.doc_date,
        notes: order.ecommerce_buyer_name,
        vat_type: "INCLUSIVE",
        vat_rate: 7,
        sales_channel: order.sales_channel,
        ecommerce_order_no: order.ecommerce_order_no,
        ecommerce_buyer_name: order.ecommerce_buyer_name,
        tracking_no: order.tracking_no,
        items: order.items.map((line, index) => ({
          product_id: line.product_id,
          description: line.description,
          qty: line.qty,
          uom_used: line.uom_used,
          unit_price: line.unit_price,
          unit_cost_price: line.cost_price,
          discount_text: line.discount_text,
          discount_amount: line.discount_amount,
          line_total: line.line_total,
          sort_order: index,
          is_service_item: line.is_service_item,
        })),
      });
      if (draft.error || !draft.data) {
        failed.push({
          order_no: order.ecommerce_order_no,
          error: draft.error ?? "สร้างร่างไม่สำเร็จ",
        });
        continue;
      }

      const issuedDoc = await issueDocument(draft.data.document_id);
      if (issuedDoc.error || !issuedDoc.data) {
        failed.push({
          order_no: order.ecommerce_order_no,
          error: issuedDoc.error ?? "ออกเลขบิลไม่สำเร็จ",
        });
        continue;
      }
      issued.push({
        order_no: order.ecommerce_order_no,
        doc_no: issuedDoc.data.document_no,
      });
    }

    return { data: { issued, skipped, failed }, error: null };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "ออกบิลออเดอร์ไม่สำเร็จ",
    };
  }
}

export async function parseTransferSlipOcr(formData: FormData): Promise<{
  data: {
    doc_date: string | null;
    reference_no: string | null;
    amount: number | null;
  } | null;
  error: string | null;
}> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) return { data: null, error: owner.error };

    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      return { data: null, error: "ไม่พบไฟล์สลิป" };
    }
    if (file.size > MAX_BYTES) {
      return { data: null, error: "ไฟล์สลิปใหญ่เกิน 8MB" };
    }
    const mimeType = file.type || "image/jpeg";
    if (!ALLOWED_BILL_MIME.has(mimeType)) {
      return { data: null, error: "รองรับเฉพาะรูป JPG, PNG, WEBP หรือ PDF" };
    }

    const generated = await readGeminiText(transferSlipPrompt(), file, mimeType);
    if ("error" in generated) return { data: null, error: generated.error };

    const parsed = parseJsonObject(generated.text);
    const docDate = normalizeIsoDate(String(parsed.transfer_date ?? ""));
    const reference = String(parsed.reference_no ?? "").trim().slice(0, 80);
    const amountRaw = Number(String(parsed.amount ?? "").replace(/,/g, ""));
    const amount =
      Number.isFinite(amountRaw) && amountRaw > 0
        ? Math.round(amountRaw * 100) / 100
        : null;

    return {
      data: {
        doc_date: docDate,
        reference_no: reference || null,
        amount,
      },
      error: null,
    };
  } catch (error) {
    return {
      data: null,
      error: error instanceof Error ? error.message : "อ่านสลิปไม่สำเร็จ",
    };
  }
}
