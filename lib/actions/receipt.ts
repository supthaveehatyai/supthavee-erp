"use server";

/**
 * Smart Goods Receipt — Server Actions.
 *
 * Zero Client-Side Fetching: `GoodsReceiptUI` never talks to Supabase
 * directly. Every read/write (OCR, vendor mapping lookup, pricing,
 * on-the-fly mapping) goes through these Server Actions using the
 * service-role admin client, same convention as `lib/actions/mapping.ts`.
 *
 * Architecture: `parseReceiptOcr` calls Gemini from this Server Action
 * (GEMINI_API_KEY). The model id is `system_parameters.GEMINI_MODEL_VERSION`.
 * If that id returns 404, the action discovers a live flash model from
 * Google's models API. It does not invoke the Edge Function, so a stale
 * deployed function cannot force a retired model id.
 */

import { revalidatePath } from "next/cache";
import {
  cleanGeminiModelId,
  GEMINI_API_KEY_MISSING_MESSAGE,
  GeminiQuotaExhaustedError,
  resolveGeminiApiKey,
} from "@/lib/ai/gemini-client";
import {
  defaultOcrQuotaModels,
  isGeminiQuotaError,
  normalizeOcrQuotaPayload,
  OCR_QUOTA_EXHAUSTED_MESSAGE,
  OCR_QUOTA_RESET_NOTE,
  parseModelCascadeOrder,
  modelsAtQuota,
} from "@/lib/ai/ocr-quota";
import { runGoodsReceiptOcr } from "@/lib/ai/goods-receipt-ocr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENT_TYPE_PREFIX,
  GOODS_RECEIPT_DOC_TYPES,
  resolveInitialPaymentStatus,
  resolveIssuedDocumentStatus,
  type GoodsReceiptDocType,
} from "@/lib/constants/document";
import { generateDraftDocumentNo } from "@/lib/utils/draft-document-no";
import { calculateNetUnitCost } from "@/lib/utils/pricing";
import {
  calculateNetCostApportionment,
  roundTo4Decimals,
  type ApportionmentItem,
} from "@/lib/utils/accounting";
import {
  calculateDocumentSummary,
  isVatCalculationType,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import {
  calculateApSubTotalWithFreight,
  calculateLandedCost,
  calculateMovingAverageUnitCost,
} from "@/lib/utils/landed-cost";
import { applyPurchaseUomConversion } from "@/lib/utils/uom-conversion";
import {
  DEFAULT_PURCHASE_UOM_CODE,
  resolveConversionFactor,
} from "@/lib/utils/purchase-uom";
import {
  buildFreightDocumentColumns,
  computeVendorPayable,
  normalizeFreightTaxMode,
  type FreightTaxMode,
} from "@/lib/utils/dual-freight";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import {
  matchVendorSkuWithConfidence,
  normalizeOcrSkuText,
} from "@/lib/utils/ocr-sku";
import type { OcrLineMatchResult, OcrLineMatchTier } from "@/types/ocr-line-match";
import type { OcrQuotaStatus } from "@/lib/ai/ocr-quota";
import { resolveProductTaxCode } from "@/lib/utils/purchase-tax";
import { fetchOnHandQtyByProductIds } from "@/lib/inventory/ledger-balances";
import type { DocumentType } from "@/types/document";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { saveDocumentProcurementBills } from "@/lib/actions/procurement-bills";
import type { ProcurementBillSet } from "@/types/procurement-bills";

function isGoodsReceiptDocType(value: string): value is GoodsReceiptDocType {
  return (GOODS_RECEIPT_DOC_TYPES as readonly string[]).includes(value);
}

/**
 * Map product_id → product_models.uom_conversion_factor (default 1).
 * Used when posting inventory_ledger IN from purchase qty (purchasing UoM).
 */
async function loadUomConversionFactorByProductId(
  supabaseAdmin: SupabaseClient,
  productIds: string[],
): Promise<{ factors: Map<string, number>; error: string | null }> {
  const uniqueIds = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  const factors = new Map<string, number>();
  for (const id of uniqueIds) factors.set(id, 1);
  if (uniqueIds.length === 0) return { factors, error: null };

  const { data: products, error: productsError } = await supabaseAdmin
    .from("products")
    .select("id, model_id")
    .in("id", uniqueIds);

  if (productsError) {
    return {
      factors,
      error: productsError.message ?? "ดึงข้อมูลสินค้าสำหรับแปลงหน่วยไม่สำเร็จ",
    };
  }

  const modelIds = [
    ...new Set(
      (products ?? [])
        .map((row) => String(row.model_id ?? "").trim())
        .filter(Boolean),
    ),
  ];
  if (modelIds.length === 0) return { factors, error: null };

  const { data: models, error: modelsError } = await supabaseAdmin
    .from("product_models")
    .select("id, uom_conversion_factor")
    .in("id", modelIds);

  if (modelsError) {
    // Column may be absent on older environments — fail soft (factor = 1)
    if (
      /uom_conversion_factor/i.test(modelsError.message ?? "") ||
      modelsError.code === "42703"
    ) {
      console.warn(
        "[loadUomConversionFactorByProductId] uom_conversion_factor missing — skip conversion",
      );
      return { factors, error: null };
    }
    return {
      factors,
      error: modelsError.message ?? "ดึงอัตราแปลงหน่วยจากรุ่นสินค้าไม่สำเร็จ",
    };
  }

  const factorByModelId = new Map<string, number>();
  for (const row of models ?? []) {
    const modelId = String(row.id ?? "").trim();
    if (!modelId) continue;
    const raw = Number(row.uom_conversion_factor ?? 1);
    factorByModelId.set(
      modelId,
      Number.isFinite(raw) && raw > 1 ? raw : 1,
    );
  }

  for (const product of products ?? []) {
    const productId = String(product.id ?? "").trim();
    const modelId = String(product.model_id ?? "").trim();
    if (!productId) continue;
    factors.set(productId, factorByModelId.get(modelId) ?? 1);
  }

  return { factors, error: null };
}

/**
 * Raw service-role client — bypasses RLS.
 * Never falls back to anon / SSR cookie clients.
 */
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

function isMissingMappingColumn(
  error: { code?: string; message?: string } | null | undefined,
  column: string,
): boolean {
  if (!error) return false;
  return (
    error.code === "42703" ||
    new RegExp(column, "i").test(error.message ?? "") ||
    /schema cache|could not find the/i.test(error.message ?? "")
  );
}

async function writeVendorMappingRow(
  supabaseAdmin: SupabaseClient,
  input: {
    existingId: string | null;
    payload: Record<string, unknown>;
    select: string;
  },
): Promise<{
  data: { id: string; product: unknown } | null;
  error: { message: string; code?: string } | null;
}> {
  let payload = { ...input.payload };

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const query = input.existingId
      ? supabaseAdmin
          .from("vendor_product_mapping")
          .update(payload)
          .eq("id", input.existingId)
      : supabaseAdmin.from("vendor_product_mapping").insert(payload);
    const result = await query.select(input.select).single();
    if (!result.error) {
      return {
        data: result.data as unknown as { id: string; product: unknown },
        error: null,
      };
    }

    const error = { message: result.error.message, code: result.error.code };
    if (isMissingMappingColumn(error, "normalized_key") && "normalized_key" in payload) {
      const { normalized_key: _ignored, ...rest } = payload;
      payload = rest;
      continue;
    }
    if (isMissingMappingColumn(error, "purchase_uom_code") && "purchase_uom_code" in payload) {
      const { purchase_uom_code: _ignored, ...rest } = payload;
      payload = rest;
      continue;
    }
    if (error.code === "23505" && input.existingId && "vendor_sku" in payload) {
      const { vendor_sku: _ignored, ...rest } = payload;
      payload = rest;
      continue;
    }
    return { data: null, error };
  }

  return { data: null, error: { message: "บันทึก mapping ไม่สำเร็จ" } };
}

/* -------------------------------------------------------------------------- */
/* Shared types                                                               */
/* -------------------------------------------------------------------------- */

/** One raw OCR line from Gemini. */
export type RawOcrLine = {
  raw_vendor_sku: string;
  raw_description?: string | null;
  qty: number;
  unit_price: number;
  discount_text: string;
  purchase_uom_code?: string | null;
  conversion_factor?: number | null;
};

export type ReceiptProductSummary = {
  id: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  /** Normalized product tax mode: EXC_VAT / INC_VAT / NON_VAT. */
  tax_type: string | null;
};

export type ReceiptMatchStatus = "matched" | "unmatched";

/** One row of the Goods Receipt review table — OCR line + match + pricing. */
export type ReceiptLineRow = {
  lineKey: string;
  raw_vendor_sku: string;
  raw_description: string | null;
  qty: number;
  unit_price: number;
  discount_text: string;
  status: ReceiptMatchStatus;
  mappingId: string | null;
  matchedProduct: ReceiptProductSummary | null;
  /** EXACT / NORMALIZED stay green. FUZZY asks the user to check color and size. */
  matchTier?: OcrLineMatchTier | null;
  similarityScore?: number | null;
  discountAmountPerUnit: number;
  netCost: number;
  /**
   * Invoice-facing line total (บาท) — editable Ground Truth from paper.
   * Net Unit Cost UI = allocated line total / (qty * conversionFactor).
   */
  totalAmount: number;
  /** Purchase unit from mst_uom. Default PCS. */
  purchaseUomCode: string;
  /** Base units per 1 purchase unit. Default 1. */
  conversionFactor: number;
  /**
   * true when user manually edited Total Amount — skip auto re-seed from
   * bill-discount apportionment.
   */
  totalAmountManual?: boolean;
  /** Free-of-Charge (ของแถม) — when true, Net Cost Apportionment forces cost = 0. */
  isFoc: boolean;
};

/** Manual header totals from AI VAT Analysis box (Decimal Leakage fix). */
export type GoodsReceiptLedgerOverrides = {
  netBeforeVat: number;
  vatAmount: number;
  grandTotal: number;
  /**
   * Manual Grand Total − Total Document Value (ผลรวม Total Amount รายบรรทัด)
   * หรือส่วนต่างปัดเศษเทียบยอดคำนวณ — เก็บลง documents.rounding_difference
   */
  roundingDifference?: number | null;
};

/** Round to 2 decimal places for DECIMAL(12,2) columns (doc_headers/doc_details). */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * LPP guard — products.cost_price ต้องมาจากต้นทุนสุทธิหลังส่วนลดเท่านั้น
 * (`unit_cost_price` / finalUnitCost จากบิลซื้อ)
 * ห้ามใช้ retail_price / wholesale_price / unit_price (ราคาตั้งก่อนหักส่วนลด)
 */
function resolveLppFromUnitCostPrice(
  unitCostPrice: number,
): number | null {
  const n = Number(unitCostPrice);
  if (!Number.isFinite(n) || n < 0) return null;
  return roundTo4Decimals(n);
}

/** NUMERIC(14,4) — ห้าม truncate เป็นจำนวนเต็มก่อนลง inventory_ledger */
function toNumeric14_4(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return roundTo4Decimals(n);
}

function shouldPostInventoryLedger(status: string): boolean {
  const normalized = status.trim().toUpperCase();
  return normalized === "ISSUED" || normalized === "PAID";
}

/* -------------------------------------------------------------------------- */
/* parseReceiptOcr (Gemini on the Next.js server)                           */
/* -------------------------------------------------------------------------- */

export type ParseReceiptOcrResult = {
  data: RawOcrLine[];
  /** Document/invoice number Gemini located on the receipt header — `null` if not found. */
  documentNumber: string | null;
  /** Document/invoice date (ISO `YYYY-MM-DD`, Buddhist Era already converted) — `null` if not found. */
  documentDate: string | null;
  /** AI-classified goods-receipt doc type — defaults to REC when missing/invalid. */
  docType: GoodsReceiptDocType;
  /** AI-classified VAT mode — defaults to NONE when missing/invalid. */
  vatType: VatCalculationType;
  /** Origin freight extracted from ค่าส่ง lines, excluded from product qty. */
  freightCost: number;
  /** Model id that actually produced this OCR result. */
  modelUsed: string | null;
  /** Set when the configured model 404'd and a live Google model was used. */
  modelNotice: string | null;
  error: string | null;
};

function emptyParseReceiptOcrResult(
  error: string | null,
): ParseReceiptOcrResult {
  return {
    data: [],
    documentNumber: null,
    documentDate: null,
    docType: "AP_TAX",
    vatType: "NONE",
    freightCost: 0,
    modelUsed: null,
    modelNotice: null,
    error,
  };
}

/**
 * Goods Receipt persists as purchase-side AP_* only.
 * OCR/vendor labels (TAX_INV / INV_DO / REC / CASH) map into AP_TAX / AP_INV / AP_CASH.
 */
function normalizeGoodsReceiptDocType(value: unknown): GoodsReceiptDocType {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");

  if (isGoodsReceiptDocType(raw)) return raw;

  if (
    raw.includes("CASH") ||
    raw.includes("เงินสด") ||
    raw === "AP_CASH"
  ) {
    return "AP_CASH";
  }
  if (
    raw.includes("TAX") ||
    raw === "TAX_INV" ||
    raw.includes("VAT") ||
    raw === "AP_TAX"
  ) {
    return "AP_TAX";
  }
  if (
    raw === "INV_DO" ||
    raw === "REC" ||
    raw === "PO" ||
    raw.includes("DELIVERY") ||
    raw === "AP_INV"
  ) {
    return "AP_INV";
  }

  return "AP_TAX";
}

function normalizeOcrVatType(value: unknown): VatCalculationType {
  const raw = String(value ?? "").trim().toUpperCase();
  if (isVatCalculationType(raw)) return raw;
  if (raw.includes("INCLUSIVE")) return "INCLUSIVE";
  if (raw.includes("EXCLUSIVE")) return "EXCLUSIVE";
  return "NONE";
}

/**
 * Real Vision AI OCR. `FormData` is required — a multi-MB Base64 string
 * blows past the Server Action Flight limit. Base64 conversion happens
 * here, then Gemini is called directly (not via the Edge Function).
 */
export async function parseReceiptOcr(
  formData: FormData,
): Promise<ParseReceiptOcrResult> {
  const vendorId = String(formData.get("vendorId") ?? "").trim();
  const files = formData
    .getAll("file")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  if (!vendorId) {
    return emptyParseReceiptOcrResult(
      "กรุณาเลือกผู้จำหน่าย (vendor) ก่อนอัปโหลดบิล",
    );
  }
  if (files.length === 0) {
    return emptyParseReceiptOcrResult("ไม่พบไฟล์รูปบิล กรุณาอัปโหลดไฟล์ก่อน");
  }

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    return emptyParseReceiptOcrResult(GEMINI_API_KEY_MISSING_MESSAGE);
  }

  const owner = await requireSessionUserId();
  if (!owner.ok) {
    return emptyParseReceiptOcrResult(owner.error);
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const images = await Promise.all(
      files.map(async (file) => ({
        mimeType: file.type || "image/jpeg",
        imageBase64: Buffer.from(await file.arrayBuffer()).toString("base64"),
      })),
    );

    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("contacts")
      .select("company_name, ocr_pattern_config")
      .eq("id", vendorId)
      .contains("contact_roles", ["Vendor"])
      .single();

    if (vendorError || !vendor) {
      return emptyParseReceiptOcrResult(
        vendorError?.message ??
          "ไม่พบข้อมูลผู้จำหน่ายสำหรับอ่าน ocr_pattern_config",
      );
    }

    const { data: paramRow, error: paramError } = await supabaseAdmin
      .from("system_parameters")
      .select("param_value")
      .eq("param_key", "GEMINI_MODEL_VERSION")
      .maybeSingle();

    if (paramError) {
      console.warn("[parseReceiptOcr] GEMINI_MODEL_VERSION:", paramError.message);
    }

    const { data: cascadeRow, error: cascadeError } = await supabaseAdmin
      .from("system_parameters")
      .select("param_value")
      .eq("param_key", "model_cascade_order")
      .maybeSingle();
    if (cascadeError) {
      console.warn("[parseReceiptOcr] model_cascade_order:", cascadeError.message);
    }

    const quotaSnapshot = await recordOcrQuota(supabaseAdmin, null, false);
    const extraction = await runGoodsReceiptOcr({
      apiKey,
      preferredModel: cleanGeminiModelId(paramRow?.param_value),
      vendorName: vendor.company_name || vendorId,
      ocrPatternConfig: vendor.ocr_pattern_config,
      images,
      modelCascade: parseModelCascadeOrder(cascadeRow?.param_value),
      skipModels: modelsAtQuota(quotaSnapshot),
      onModelOutcome: async ({ model, exhausted }) => {
        await recordOcrQuota(supabaseAdmin, model, exhausted);
      },
    });

    return {
      data: extraction.items,
      documentNumber: extraction.document_number,
      documentDate: extraction.document_date,
      docType: normalizeGoodsReceiptDocType(extraction.doc_type),
      vatType: normalizeOcrVatType(extraction.vat_type),
      freightCost: Number(extraction.freight_cost) || 0,
      modelUsed: extraction.modelUsed,
      modelNotice: extraction.modelNotice,
      error: null,
    };
  } catch (err) {
    if (
      err instanceof GeminiQuotaExhaustedError ||
      (err instanceof Error && err.name === "GeminiQuotaExhaustedError")
    ) {
      return emptyParseReceiptOcrResult(OCR_QUOTA_EXHAUSTED_MESSAGE);
    }
    const message =
      err instanceof Error ? err.message : "วิเคราะห์บิลด้วย OCR ไม่สำเร็จ";
    if (isGeminiQuotaError(undefined, message)) {
      return emptyParseReceiptOcrResult(OCR_QUOTA_EXHAUSTED_MESSAGE);
    }
    return emptyParseReceiptOcrResult(message);
  }
}

function isMissingOcrQuotaRpc(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "PGRST202" ||
    /record_and_get_ocr_quota|does not exist|could not find the function|schema cache/i.test(
      message,
    )
  );
}

async function recordOcrQuota(
  supabaseAdmin: SupabaseClient,
  model: string | null,
  exhausted: boolean,
): Promise<unknown> {
  const rpcClient = supabaseAdmin as unknown as {
    rpc: (
      fn: "record_and_get_ocr_quota",
      args: { p_model_used: string | null; p_is_exhausted: boolean },
    ) => Promise<{
      data: unknown;
      error: { code?: string; message?: string } | null;
    }>;
  };
  const { data, error } = await rpcClient.rpc("record_and_get_ocr_quota", {
    p_model_used: model,
    p_is_exhausted: exhausted,
  });
  if (error && isMissingOcrQuotaRpc(error)) {
    console.warn("[ocr-quota] record_and_get_ocr_quota is not deployed:", error.message);
    return null;
  }
  if (error) {
    console.warn("[ocr-quota]", error.message);
    return null;
  }
  return data;
}

export async function getOcrQuotaStatusAction(): Promise<OcrQuotaStatus> {
  const owner = await requireSessionUserId();
  if (!owner.ok) {
    return { models: [], resetNote: OCR_QUOTA_RESET_NOTE, error: owner.error };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const data = await recordOcrQuota(supabaseAdmin, null, false);
    return {
      models: normalizeOcrQuotaPayload(data),
      resetNote: OCR_QUOTA_RESET_NOTE,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "อ่านโควตา OCR ไม่สำเร็จ";
    return {
      models: defaultOcrQuotaModels(),
      resetNote: OCR_QUOTA_RESET_NOTE,
      error: message,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* matchReceiptItemsToProducts                                               */
/* -------------------------------------------------------------------------- */

export type MatchReceiptItemsResult = {
  data: ReceiptLineRow[];
  error: string | null;
};

type MappingProductJoin = {
  id: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  tax_type: string | null;
  product_models:
    | { is_service?: boolean | null; tax_type?: string | null }
    | { is_service?: boolean | null; tax_type?: string | null }[]
    | null;
};

type VendorMappingCandidate = {
  id: string;
  vendorSku: string;
  normalizedKey: string | null;
  product: ReceiptProductSummary;
};

const VENDOR_MAPPING_PRODUCT_SELECT = `
  id,
  sku,
  name,
  color,
  size,
  tax_type,
  product_models!inner ( is_service, tax_type )
`;

function toReceiptProduct(productRaw: MappingProductJoin): ReceiptProductSummary | null {
  const modelJoin = Array.isArray(productRaw.product_models)
    ? (productRaw.product_models[0] ?? null)
    : productRaw.product_models;
  if (modelJoin?.is_service === true) return null;
  return {
    id: productRaw.id,
    sku: productRaw.sku,
    name: productRaw.name,
    color: productRaw.color,
    size: productRaw.size,
    tax_type: resolveProductTaxCode(
      productRaw.tax_type,
      modelJoin && "tax_type" in modelJoin ? modelJoin.tax_type : null,
    ),
  };
}

async function loadVendorMappingCandidates(
  supabaseAdmin: SupabaseClient,
  vendorId: string,
): Promise<{ candidates: VendorMappingCandidate[]; error: string | null }> {
  const selectWithKey = `
    id,
    vendor_sku,
    normalized_key,
    product:products!inner ( ${VENDOR_MAPPING_PRODUCT_SELECT} )
  `;
  const selectWithoutKey = `
    id,
    vendor_sku,
    product:products!inner ( ${VENDOR_MAPPING_PRODUCT_SELECT} )
  `;

  const fetchRows = (columns: string) =>
    fetchAllPages<{
      id: string;
      vendor_sku: string;
      normalized_key?: string | null;
      product: MappingProductJoin | MappingProductJoin[] | null;
    }>((from, to) =>
      supabaseAdmin
        .from("vendor_product_mapping")
        .select(columns)
        .eq("vendor_id", vendorId)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<{
        data: {
          id: string;
          vendor_sku: string;
          normalized_key?: string | null;
          product: MappingProductJoin | MappingProductJoin[] | null;
        }[] | null;
        error: { message: string; code?: string } | null;
      }>,
    );

  let page = await fetchRows(selectWithKey);
  if (page.error && isMissingMappingColumn(page.error, "normalized_key")) {
    page = await fetchRows(selectWithoutKey);
  }
  if (page.error && page.error.code !== "42P01") {
    return { candidates: [], error: page.error.message };
  }

  const candidates: VendorMappingCandidate[] = [];
  for (const row of page.data ?? []) {
    const productRaw = Array.isArray(row.product) ? (row.product[0] ?? null) : row.product;
    if (!productRaw) continue;
    const product = toReceiptProduct(productRaw);
    if (!product) continue;
    candidates.push({
      id: String(row.id),
      vendorSku: String(row.vendor_sku ?? ""),
      normalizedKey: row.normalized_key ? String(row.normalized_key) : null,
      product,
    });
  }

  return { candidates, error: null };
}

/**
 * Looks up each OCR line against `vendor_product_mapping` (+ joined
 * `products`) for the given vendor, and computes net cost via
 * {@link calculateNetUnitCost}. Runs entirely server-side — the UI only ever
 * receives the finished `ReceiptLineRow[]`.
 */
export async function matchReceiptItemsToProducts(
  vendorId: string,
  items: RawOcrLine[],
): Promise<MatchReceiptItemsResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { data: [], error: owner.error };

  const trimmedVendorId = vendorId?.trim() ?? "";
  if (!trimmedVendorId) {
    return { data: [], error: "กรุณาเลือกผู้จำหน่าย (vendor) ก่อน" };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { data: [], error: null };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const loaded = await loadVendorMappingCandidates(supabaseAdmin, trimmedVendorId);
    if (loaded.error) {
      return { data: [], error: loaded.error };
    }

    const rows: ReceiptLineRow[] = items.map((item, index) => {
      const normalizedSku = normalizeOcrSkuText(item.raw_vendor_sku);
      const match = matchVendorSkuWithConfidence(item.raw_vendor_sku, loaded.candidates);
      const { unitCostPrice, discountAmountPerUnit } = calculateNetUnitCost(
        item.unit_price,
        item.discount_text,
      );

      const qty = Number(item.qty) || 0;
      const purchaseUomCode =
        String(item.purchase_uom_code ?? "").trim().toUpperCase() ||
        DEFAULT_PURCHASE_UOM_CODE;
      const conversionFactor =
        purchaseUomCode === "DZN"
          ? resolveConversionFactor(item.conversion_factor ?? 12)
          : resolveConversionFactor(item.conversion_factor ?? 1);
      const baseQty = qty * conversionFactor;
      return {
        lineKey: `${index}:${normalizedSku}:${item.unit_price}:${item.discount_text ?? ""}`,
        raw_vendor_sku: item.raw_vendor_sku,
        raw_description: item.raw_description ?? null,
        qty,
        unit_price: Number(item.unit_price) || 0,
        discount_text: item.discount_text ?? "",
        status: match ? "matched" : "unmatched",
        mappingId: match?.candidate.id ?? null,
        matchedProduct: match?.candidate.product ?? null,
        matchTier: match?.matchTier ?? null,
        similarityScore: match?.similarityScore ?? null,
        discountAmountPerUnit,
        netCost: baseQty > 0 ? roundTo4Decimals(unitCostPrice / conversionFactor) : 0,
        totalAmount: roundMoney(unitCostPrice * qty),
        purchaseUomCode,
        conversionFactor,
        totalAmountManual: false,
        isFoc: false,
      };
    });

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "จับคู่รายการ OCR ไม่สำเร็จ";
    return { data: [], error: message };
  }
}

function emptyOcrLineMatch(error: string | null = null): OcrLineMatchResult {
  return {
    matched: false,
    mappingId: null,
    internal_product_id: null,
    sku: null,
    product_name: null,
    color: null,
    size: null,
    default_tax_type: null,
    purchase_uom_code: null,
    conversion_factor: null,
    match_tier: null,
    similarity_score: null,
    error,
  };
}

function isMissingOcrMatchRpc(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "PGRST202" ||
    /match_vendor_ocr_line_item|does not exist|could not find the function|schema cache/i.test(
      message,
    )
  );
}

function asOcrMatchTier(value: unknown): OcrLineMatchTier | null {
  const raw = String(value ?? "").trim().toUpperCase();
  if (raw === "EXACT" || raw === "NORMALIZED" || raw === "FUZZY") return raw;
  return null;
}

function firstOcrRpcRow(data: unknown): Record<string, unknown> | null {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") return null;
  return row as Record<string, unknown>;
}

async function findVendorMappingId(
  supabaseAdmin: SupabaseClient,
  vendorId: string,
  internalProductId: string,
  rawVendorSku: string,
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("vendor_product_mapping")
    .select("id, vendor_sku")
    .eq("vendor_id", vendorId)
    .eq("internal_product_id", internalProductId);
  if (error || !data?.length) return null;
  const exact = data.find((row) => String(row.vendor_sku ?? "").trim() === rawVendorSku);
  return String((exact ?? data[0]).id);
}

/**
 * Re-match one edited OCR line without scanning the whole bill again.
 * Prefers RPC `match_vendor_ocr_line_item`. Falls back to the in-app
 * vendor mapping matcher when that function is not deployed yet.
 */
export async function rematchSingleOcrLineAction(
  vendorId: string,
  rawVendorSku: string,
): Promise<OcrLineMatchResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return emptyOcrLineMatch(owner.error);

  const trimmedVendorId = vendorId.trim();
  const raw = rawVendorSku.trim();
  if (!trimmedVendorId) return emptyOcrLineMatch("กรุณาเลือกผู้จำหน่าย");
  if (!raw) return emptyOcrLineMatch("ข้อความสินค้าจากบิลว่างเปล่า");

  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const rpcClient = supabaseAdmin as unknown as {
      rpc: (
        fn: "match_vendor_ocr_line_item",
        args: { p_vendor_id: string; p_raw_vendor_sku: string },
      ) => Promise<{
        data: unknown;
        error: { code?: string; message?: string } | null;
      }>;
    };
    const { data, error } = await rpcClient.rpc("match_vendor_ocr_line_item", {
      p_vendor_id: trimmedVendorId,
      p_raw_vendor_sku: raw,
    });

    if (error && !isMissingOcrMatchRpc(error)) {
      return emptyOcrLineMatch(error.message ?? "จับคู่รายการไม่สำเร็จ");
    }

    if (!error) {
      const row = firstOcrRpcRow(data);
      const productId = String(row?.internal_product_id ?? "").trim();
      if (!productId) return emptyOcrLineMatch(null);
      const mappingId = await findVendorMappingId(
        supabaseAdmin,
        trimmedVendorId,
        productId,
        raw,
      );
      const factor = Number(row?.conversion_factor);
      return {
        matched: true,
        mappingId,
        internal_product_id: productId,
        sku: row?.sku == null ? null : String(row.sku),
        product_name: row?.product_name == null ? null : String(row.product_name),
        color: row?.color == null ? null : String(row.color),
        size: row?.size == null ? null : String(row.size),
        default_tax_type: resolveProductTaxCode(
          row?.default_tax_type == null ? null : String(row.default_tax_type),
        ),
        purchase_uom_code:
          row?.purchase_uom_code == null
            ? null
            : String(row.purchase_uom_code).trim().toUpperCase(),
        conversion_factor: Number.isFinite(factor) && factor > 0 ? factor : null,
        match_tier: asOcrMatchTier(row?.match_tier),
        similarity_score:
          row?.similarity_score == null || !Number.isFinite(Number(row.similarity_score))
            ? null
            : Number(row.similarity_score),
        error: null,
      };
    }

    const loaded = await loadVendorMappingCandidates(supabaseAdmin, trimmedVendorId);
    if (loaded.error) return emptyOcrLineMatch(loaded.error);
    const scored = matchVendorSkuWithConfidence(raw, loaded.candidates);
    if (!scored) return emptyOcrLineMatch(null);
    const product = scored.candidate.product;
    return {
      matched: true,
      mappingId: scored.candidate.id,
      internal_product_id: product.id,
      sku: product.sku,
      product_name: product.name,
      color: product.color,
      size: product.size,
      default_tax_type: product.tax_type,
      purchase_uom_code: null,
      conversion_factor: null,
      match_tier: scored.matchTier,
      similarity_score: scored.similarityScore,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "จับคู่รายการไม่สำเร็จ";
    return emptyOcrLineMatch(message);
  }
}

/* -------------------------------------------------------------------------- */
/* getInternalProductsForMatching                                            */
/* -------------------------------------------------------------------------- */

export type GetInternalProductsResult = {
  data: ReceiptProductSummary[];
  error: string | null;
};

/** Active products for on-the-fly mapping — raw materials + finished goods only (no services). */
export async function getInternalProductsForMatching(): Promise<GetInternalProductsResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) {
    return { data: [], error: owner.error };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const page = await fetchAllPages<{
      id: string;
      sku: string;
      name: string | null;
      color: string | null;
      size: string | null;
      tax_type: string | null;
      product_models:
        | { is_raw_material?: boolean | null; is_service?: boolean | null; tax_type?: string | null }
        | { is_raw_material?: boolean | null; is_service?: boolean | null; tax_type?: string | null }[]
        | null;
    }>((from, to) =>
      supabaseAdmin
        .from("products")
        .select(
          `
        id,
        sku,
        name,
        color,
        size,
        tax_type,
        product_models!inner (
          is_raw_material,
          is_service,
          tax_type
        )
      `,
        )
        .eq("is_active", true)
        .eq("product_models.is_service", false)
        .order("sku", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );

    if (page.error) {
      return { data: [], error: page.error.message };
    }

    const rows = page.data.map((row) => {
      const modelJoin = Array.isArray(row.product_models)
        ? (row.product_models[0] ?? null)
        : row.product_models;
      return {
        id: String(row.id),
        sku: String(row.sku),
        name: String(row.name ?? ""),
        color: row.color ? String(row.color) : null,
        size: row.size ? String(row.size) : null,
        tax_type: resolveProductTaxCode(row.tax_type, modelJoin?.tax_type),
      } satisfies ReceiptProductSummary;
    });

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ไม่สามารถโหลดรายการสินค้าได้";
    return { data: [], error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* createOnTheFlyReceiptMapping                                              */
/* -------------------------------------------------------------------------- */

export type CreateOnTheFlyReceiptMappingInput = {
  vendorId: string;
  vendorSku: string;
  vendorProductName?: string | null;
  internalProductId: string;
  purchaseUomCode?: string | null;
  conversionFactor?: number | null;
};

export type CreateOnTheFlyReceiptMappingResult = {
  mappingId: string | null;
  product: ReceiptProductSummary | null;
  error: string | null;
  code?: string;
};

/**
 * Resolve an "unmatched" OCR line right from the review table by UPSERTing
 * into `vendor_product_mapping`, so the same SKU auto-matches next time.
 *
 * Business rule: `vendor_product_mapping` is a dictionary keyed on
 * `(vendor_id, vendor_sku)` (its actual DB unique constraint is
 * `vendor_product_mapping_vendor_id_vendor_sku_key`) that always holds the
 * *latest* confirmed internal product for that vendor SKU — NOT a
 * write-once Ground Truth log. Vendors commonly group multiple
 * sizes/colors under one SKU on their invoice, so OCR can legitimately
 * extract the same `raw_vendor_sku` on several rows of the same receipt;
 * confirming a later row must overwrite the mapping, not throw "already
 * mapped". `.upsert(..., { onConflict: "vendor_id,vendor_sku" })` makes a
 * repeat confirmation a plain UPDATE instead of a unique-violation error.
 */
export async function createOnTheFlyReceiptMapping(
  input: CreateOnTheFlyReceiptMappingInput,
): Promise<CreateOnTheFlyReceiptMappingResult> {
  const owner = await requireSessionUserId();
  if (!owner.ok) {
    return { mappingId: null, product: null, error: owner.error };
  }

  const vendorId = input.vendorId?.trim() ?? "";
  const vendorSku = (input.vendorSku ?? "").trim();
  const normalizedKey = normalizeOcrSkuText(vendorSku);
  const internalProductId = input.internalProductId?.trim() ?? "";

  if (!vendorId) return { mappingId: null, product: null, error: "กรุณาเลือกผู้จำหน่าย" };
  if (!internalProductId)
    return { mappingId: null, product: null, error: "กรุณาเลือกสินค้าภายใน" };
  if (!vendorSku)
    return { mappingId: null, product: null, error: "รหัสสินค้าโรงงานว่างเปล่า" };

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data: eligibleProduct, error: productLookupError } = await supabaseAdmin
      .from("products")
      .select(
        `
        id,
        sku,
        name,
        color,
        size,
        tax_type,
        product_models!inner ( is_service, tax_type )
      `,
      )
      .eq("id", internalProductId)
      .eq("is_active", true)
      .eq("product_models.is_service", false)
      .maybeSingle();

    if (productLookupError) {
      return {
        mappingId: null,
        product: null,
        error: productLookupError.message,
      };
    }
    if (!eligibleProduct) {
      return {
        mappingId: null,
        product: null,
        error:
          "ไม่สามารถจับคู่งานบริการ (Service) เข้าคลัง — เลือกวัตถุดิบหรือสินค้าสำเร็จรูป",
      };
    }

    const rpcClient = supabaseAdmin as unknown as {
      rpc: (
        fn: "upsert_ocr_vendor_mapping",
        args: {
          p_vendor_id: string;
          p_vendor_sku: string;
          p_internal_product_id: string;
          p_vendor_product_name: string | null;
          p_purchase_uom_code: string;
          p_conversion_factor: number;
        },
      ) => Promise<{ error: { code?: string; message?: string } | null }>;
    };
    const purchaseUomCode =
      String(input.purchaseUomCode ?? "").trim().toUpperCase() ||
      DEFAULT_PURCHASE_UOM_CODE;
    const conversionFactor = resolveConversionFactor(input.conversionFactor ?? 1);
    const { error: rpcError } = await rpcClient.rpc("upsert_ocr_vendor_mapping", {
      p_vendor_id: vendorId,
      p_vendor_sku: vendorSku,
      p_internal_product_id: internalProductId,
      p_vendor_product_name: input.vendorProductName?.trim() || null,
      p_purchase_uom_code: purchaseUomCode,
      p_conversion_factor: conversionFactor,
    });
    if (
      rpcError &&
      rpcError.code !== "PGRST202" &&
      !/upsert_ocr_vendor_mapping|does not exist|could not find the function|schema cache/i.test(
        rpcError.message ?? "",
      )
    ) {
      return { mappingId: null, product: null, error: rpcError.message ?? "บันทึก mapping ไม่สำเร็จ" };
    }

    const loaded = await loadVendorMappingCandidates(supabaseAdmin, vendorId);
    if (loaded.error) {
      return { mappingId: null, product: null, error: loaded.error };
    }
    const existing =
      loaded.candidates.find((candidate) => candidate.vendorSku.trim() === vendorSku) ??
      null;
    const mappingPayload: Record<string, unknown> = {
      vendor_id: vendorId,
      vendor_sku: vendorSku,
      vendor_product_name: input.vendorProductName?.trim() || null,
      vendor_uom: purchaseUomCode,
      purchase_uom_code: purchaseUomCode,
      internal_product_id: internalProductId,
      conversion_factor: conversionFactor,
      normalized_key: normalizedKey || null,
    };
    const mappingSelect = `
      id,
      product:products ( id, sku, name, color, size, tax_type )
    `;
    const written = await writeVendorMappingRow(supabaseAdmin, {
      existingId: existing?.id ?? null,
      payload: mappingPayload,
      select: mappingSelect,
    });
    let data = written.data;
    let error = written.error;

    if (error?.code === "23505") {
      const { data: conflict } = await supabaseAdmin
        .from("vendor_product_mapping")
        .select("id")
        .eq("vendor_id", vendorId)
        .eq("vendor_sku", vendorSku)
        .maybeSingle();
      if (conflict?.id) {
        const retried = await writeVendorMappingRow(supabaseAdmin, {
          existingId: String(conflict.id),
          payload: mappingPayload,
          select: mappingSelect,
        });
        data = retried.data;
        error = retried.error;
      }
    }

    if (error) {
      return { mappingId: null, product: null, error: error.message, code: error.code };
    }

    type EligibleProduct = {
      id: string;
      sku: string;
      name: string | null;
      color: string | null;
      size: string | null;
      tax_type: string | null;
      product_models:
        | { is_service?: boolean | null; tax_type?: string | null }
        | { is_service?: boolean | null; tax_type?: string | null }[]
        | null;
    };
    const eligible = eligibleProduct as EligibleProduct;
    const eligibleModel = Array.isArray(eligible.product_models)
      ? (eligible.product_models[0] ?? null)
      : eligible.product_models;
    const resolvedTax = resolveProductTaxCode(
      eligible.tax_type,
      eligibleModel?.tax_type,
    );

    type Row = {
      id: string;
      product:
        | (ReceiptProductSummary & { tax_type?: string | null })
        | (ReceiptProductSummary & { tax_type?: string | null })[]
        | null;
    };
    const row = data as Row;
    const joined = Array.isArray(row.product)
      ? (row.product[0] ?? null)
      : row.product;
    const source = joined ?? {
      id: eligible.id,
      sku: eligible.sku,
      name: eligible.name ?? "",
      color: eligible.color,
      size: eligible.size,
      tax_type: eligible.tax_type,
    };

    return {
      mappingId: row.id,
      product: {
        id: String(source.id),
        sku: String(source.sku),
        name: String(source.name ?? ""),
        color: source.color ? String(source.color) : null,
        size: source.size ? String(source.size) : null,
        tax_type: resolveProductTaxCode(source.tax_type, eligibleModel?.tax_type) ?? resolvedTax,
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "บันทึก mapping ไม่สำเร็จ";
    return { mappingId: null, product: null, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* checkDuplicateInvoice                                                     */
/* -------------------------------------------------------------------------- */

export type CheckDuplicateInvoiceResult = {
  /** true if a `doc_headers` row already exists for this exact (vendor, doc_no, doc_date) combo. */
  isDuplicate: boolean;
  error: string | null;
};

/**
 * Early-warning check for `saveGoodsReceiptToLedger`'s
 * `doc_headers_contact_doc_no_date_key` UNIQUE constraint — run this right
 * after OCR extracts the invoice number/date (or on manual edit) so the
 * user finds out BEFORE hitting the DB error.
 *
 * Business rule: a duplicate invoice = the EXACT combination of
 * `vendor_id` + `document_number` + `document_date`. Many vendors reset
 * their own invoice numbering every month, so the same `doc_no` legitimately
 * recurs for the same vendor across different months — this check (and the
 * matching DB constraint) intentionally does NOT flag that as a duplicate.
 */
export async function checkDuplicateInvoice(
  vendorId: string,
  docNumber: string,
  docDate: string,
): Promise<CheckDuplicateInvoiceResult> {
  const trimmedVendorId = vendorId?.trim() ?? "";
  const trimmedDocNumber = docNumber?.trim() ?? "";
  const trimmedDocDate = docDate?.trim() ?? "";

  if (!trimmedVendorId || !trimmedDocNumber || !trimmedDocDate) {
    return { isDuplicate: false, error: null };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("doc_headers")
      .select("id")
      .eq("contact_id", trimmedVendorId)
      .eq("doc_no", trimmedDocNumber)
      .eq("doc_date", trimmedDocDate)
      .maybeSingle();

    if (error) {
      return { isDuplicate: false, error: error.message };
    }

    return { isDuplicate: Boolean(data), error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ตรวจสอบเลขที่เอกสารซ้ำไม่สำเร็จ";
    return { isDuplicate: false, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* saveGoodsReceiptToLedger                                                  */
/* -------------------------------------------------------------------------- */

export type SaveGoodsReceiptToLedgerResult = {
  docHeaderId: string | null;
  docNo: string | null;
  error: string | null;
};

/**
 * Finalize a Goods Receipt: creates the financial document (`doc_headers` +
 * `doc_details`), mirrors a Phase 4 Purchase Document (`documents` +
 * `document_items`, `doc_type = REC`, `contact_id = vendor`), AND the stock
 * movement (`inventory_ledger`) in one call.
 *
 * ERP Blueprint rule: stock is NEVER written to `products` directly — the
 * only source of truth for on-hand quantity is `inventory_ledger`. This
 * action is the single place that inserts "IN" movements for a receipt.
 *
 * Pricing is recomputed server-side from `unit_price` + `discount_text` via
 * {@link calculateNetCostApportionment} — `row.netCost` /
 * `row.discountAmountPerUnit` from the client are NOT trusted for the
 * actual insert (a Server Action boundary is still an untrusted network
 * edge). `calculateNetCostApportionment` supersedes the simpler
 * {@link calculateNetUnitCost} (still used for the live preview in
 * `matchReceiptItemsToProducts`) for the FINAL save — it additionally
 * supports FOC (`isFoc`) lines and prorates an optional end-of-bill
 * discount (`billDiscountText`) across every line by relative value.
 *
 * After a successful `inventory_ledger` insert, each non-FOC line's
 * landed unit cost (net + apportioned freight) updates `products.cost_price`
 * via Moving Average — master data stays in sync without client-side calls.
 *
 * `vendorId` is intentionally NOT a parameter — it's derived from each row's
 * `mappingId` (`vendor_product_mapping.vendor_id`), the same Ground Truth
 * already used to resolve the match. All rows must resolve to the SAME
 * vendor (one receipt document = one vendor), same convention as `doc_headers.contact_id`
 * and Phase 4 `documents.contact_id`.
 *
 * Writes in this order, matching Manual Goods Receipt:
 * 1. `documents` header, then `.select('id, doc_no').single()`
 * 2. `doc_headers` with that same `id`
 * 3. `doc_details` + `document_items` using only that id
 * 4. `inventory_ledger` IN (`doc_header_id` = the selected document id)
 * 5. `products.cost_price`
 * Ledger is never inserted before the header select succeeds.
 *
 * `documentDate` is the ACTUAL invoice date printed on the vendor's receipt
 * (ISO `YYYY-MM-DD`, reviewed/edited by the user in the Save to Ledger
 * dialog) — NOT today's date. It's part of the duplicate-invoice identity
 * (`vendor_id` + `doc_no` + `doc_date`, enforced by
 * `doc_headers_contact_doc_no_date_key`), so an incorrect date here would
 * silently defeat that constraint. Falls back to today only if left blank.
 *
 * `billDiscountText` (optional, e.g. `"5%"` or `"200"`) — an end-of-bill
 * discount some vendors stamp once at the bottom of the invoice, on top of
 * each line's own `discount_text`. Omitted/`null` — no bill-level discount
 * is applied (existing call sites in `GoodsReceiptUI`, which is a locked
 * module, are unaffected since this is a new trailing optional param).
 */
function isUniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key|unique constraint/i.test(error.message ?? "");
}

async function rollbackOcrGoodsReceipt(
  supabaseAdmin: SupabaseClient,
  headerId: string,
): Promise<void> {
  const id = headerId.trim();
  if (!id) return;
  await supabaseAdmin.from("inventory_ledger").delete().eq("doc_header_id", id);
  await supabaseAdmin.from("inventory_ledger").delete().eq("document_id", id);
  await supabaseAdmin.from("document_items").delete().eq("document_id", id);
  await supabaseAdmin.from("doc_details").delete().eq("doc_header_id", id);
  await supabaseAdmin.from("doc_headers").delete().eq("id", id);
  await supabaseAdmin.from("documents").delete().eq("id", id);
}

async function linkProcurementBills(
  supabaseAdmin: SupabaseClient,
  input: {
    documentId?: string | null;
    docNo?: string | null;
    docHeaderId?: string | null;
    bills?: ProcurementBillSet | null;
  },
): Promise<string | null> {
  if (!input.bills || input.bills.attachments.length === 0) return null;
  let documentId = input.documentId?.trim() ?? "";
  if (!documentId && input.docNo) {
    const { data, error } = await supabaseAdmin
      .from("documents")
      .select("id")
      .eq("doc_no", input.docNo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) return error.message;
    documentId = data?.id ? String(data.id) : "";
  }
  if (!documentId) return "ไม่พบเอกสารสำหรับผูกไฟล์บิล";
  const saved = await saveDocumentProcurementBills({
    documentId,
    docHeaderId: input.docHeaderId,
    bills: input.bills,
  });
  return saved.success ? null : saved.error;
}

export async function saveGoodsReceiptToLedger(
  rows: ReceiptLineRow[],
  documentRef: string,
  documentDate: string,
  billDiscountText?: string | null,
  docType: GoodsReceiptDocType = "AP_TAX",
  vatType: VatCalculationType = "NONE",
  attachmentUrl?: string | null,
  /** Manual override จากกล่อง AI VAT Analysis — ยึดตัวเลขที่ผู้ใช้พิมพ์ */
  ledgerOverrides?: GoodsReceiptLedgerOverrides | null,
  /** ค่าขนส่งต้นทาง (Freight-In) — รวมในหนี้ผู้ขาย และกระจายลงต้นทุนสินค้า */
  freightCost?: number | null,
  freightContext?: {
    freightTaxMode?: FreightTaxMode | null;
    destFreightCost?: number | null;
    carrierId?: string | null;
    carrierTrackingNo?: string | null;
  } | null,
  billAttachments?: ProcurementBillSet | null,
): Promise<SaveGoodsReceiptToLedgerResult> {
  if (!Array.isArray(rows) || rows.length === 0) {
    return { docHeaderId: null, docNo: null, error: "ไม่มีรายการให้บันทึกรับสินค้า" };
  }

  const resolvedDocType: GoodsReceiptDocType = isGoodsReceiptDocType(docType)
    ? docType
    : "AP_TAX";
  const resolvedVatType: VatCalculationType = isVatCalculationType(vatType)
    ? vatType
    : "NONE";
  const vatRate = resolvedVatType === "NONE" ? 0 : 7;

  const badRow = rows.find(
    (row) => row.status !== "matched" || !row.mappingId || !row.matchedProduct,
  );
  if (badRow) {
    return {
      docHeaderId: null,
      docNo: null,
      error: `มีรายการที่ยังไม่จับคู่สินค้าภายใน: "${badRow.raw_vendor_sku}" — กรุณา Confirm Mapping ให้ครบก่อนบันทึก`,
    };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    // Resolve the vendor from each row's mapping — must all agree (one doc = one vendor).
    const mappingIds = [...new Set(rows.map((row) => row.mappingId as string))];
    const { data: mappings, error: mappingError } = await supabaseAdmin
      .from("vendor_product_mapping")
      .select("id, vendor_id")
      .in("id", mappingIds);

    if (mappingError || !mappings || mappings.length === 0) {
      return {
        docHeaderId: null,
        docNo: null,
        error: mappingError?.message ?? "ไม่พบข้อมูล mapping สำหรับรายการที่จับคู่ไว้",
      };
    }

    const vendorIds = new Set(
      (mappings as { id: string; vendor_id: string }[]).map((m) => m.vendor_id),
    );
    if (vendorIds.size > 1) {
      return {
        docHeaderId: null,
        docNo: null,
        error: "รายการในตารางมาจากผู้จำหน่ายมากกว่า 1 เจ้า — บันทึกเป็นเอกสารเดียวไม่ได้",
      };
    }
    const vendorId = [...vendorIds][0];

    const qtyByLineKey = new Map(
      rows.map((row) => [row.lineKey, toNumeric14_4(row.qty)]),
    );

    const zeroQtyRow = rows.find((row) => (qtyByLineKey.get(row.lineKey) ?? 0) <= 0);
    if (zeroQtyRow) {
      return {
        docHeaderId: null,
        docNo: null,
        error: `รายการ "${zeroQtyRow.raw_vendor_sku}" มีจำนวน (qty) ไม่ถูกต้อง`,
      };
    }

    // Net Cost Apportionment Engine — baseline from unit_price/discount/FOC.
    // When the UI supplies `totalAmount` (paper Ground Truth / manual override),
    // that value becomes the invoice `line_total` and net unit cost = total/qty
    // (INCLUSIVE: strip VAT from the overridden total before LPP).
    const apportionmentItems: ApportionmentItem[] = rows.map((row) => ({
      id: row.lineKey,
      unitPrice: Number(row.unit_price) || 0,
      qty: qtyByLineKey.get(row.lineKey) ?? 0,
      discountText: row.discount_text,
      isFoc: Boolean(row.isFoc),
    }));

    const costApportionmentByLineKey = new Map(
      calculateNetCostApportionment(apportionmentItems, billDiscountText ?? null, {
        vatType: resolvedVatType,
        vatRate: resolvedVatType === "NONE" ? 0 : 7,
      }).map((result) => [result.id, result]),
    );

    const invoiceApportionmentByLineKey = new Map(
      calculateNetCostApportionment(apportionmentItems, billDiscountText ?? null, {
        vatType: "NONE",
        vatRate: 0,
      }).map((result) => [result.id, result]),
    );

    const lines = rows.map((row) => {
      const qty = qtyByLineKey.get(row.lineKey) ?? 0;
      const unitPrice = Number(row.unit_price) || 0;
      const costApportioned = costApportionmentByLineKey.get(row.lineKey);
      const invoiceApportioned = invoiceApportionmentByLineKey.get(row.lineKey);
      const isFoc = Boolean(row.isFoc);

      let lineTotal: number;
      let unitCostPrice: number;

      if (isFoc) {
        lineTotal = 0;
        unitCostPrice = 0;
      } else if (
        row.totalAmount != null &&
        Number.isFinite(Number(row.totalAmount))
      ) {
        // Paper / manual Total Amount is source of truth for this line
        lineTotal = roundMoney(Math.max(0, Number(row.totalAmount)));
        let costLineTotal = lineTotal;
        if (resolvedVatType === "INCLUSIVE" && vatRate > 0) {
          costLineTotal = lineTotal / (1 + vatRate / 100);
        }
        // LPP / ledger cost — keep 4+ decimal places (no 2-dp money rounding)
        unitCostPrice =
          qty > 0 ? roundTo4Decimals(costLineTotal / qty) : 0;
      } else {
        lineTotal = roundMoney(invoiceApportioned?.finalLineTotal ?? 0);
        unitCostPrice = roundTo4Decimals(
          costApportioned?.finalUnitCost ?? 0,
        );
      }

      const discountAmount = roundMoney(unitPrice * qty - lineTotal);
      return { row, qty, unitPrice, unitCostPrice, discountAmount, lineTotal };
    });

    const freightCostNormalized = roundMoney(
      Math.max(0, Number(freightCost) || 0),
    );

    /** Landed Cost — prorate header freight_cost by ex-VAT net line value (remainder on last line). */
    const landedCostByLineKey = new Map(
      calculateLandedCost(
        freightCostNormalized,
        lines.map((line) => ({
          id: line.row.lineKey,
          qty: line.qty,
          lineNetAmount: line.row.isFoc
            ? 0
            : roundTo4Decimals(line.unitCostPrice * line.qty),
          unitNetCost: line.unitCostPrice,
          isFoc: Boolean(line.row.isFoc),
        })),
        {
          vatType: resolvedVatType,
          vatRate,
          freightTaxMode: normalizeFreightTaxMode(freightContext?.freightTaxMode),
          destFreightCost: freightContext?.destFreightCost,
        },
      ).map((row) => [row.id, row]),
    );

    const proratedFreightByLineKey = new Map(
      [...landedCostByLineKey.entries()].map(([id, row]) => [
        id,
        row.proratedFreight,
      ]),
    );

    const landedUnitCostByLineKey = new Map(
      [...landedCostByLineKey.entries()].map(([id, row]) => [
        id,
        row.landedUnitCost,
      ]),
    );

    const subTotal = calculateApSubTotalWithFreight(
      lines.map((line) => line.lineTotal),
      freightCostNormalized,
    );
    const discountAmount = roundMoney(
      lines.reduce((sum, line) => sum + line.discountAmount, 0),
    );

    const freightTaxMode = normalizeFreightTaxMode(freightContext?.freightTaxMode);
    const destFreightNormalized = roundMoney(
      Math.max(0, Number(freightContext?.destFreightCost) || 0),
    );
    if (destFreightNormalized > 0 && !freightContext?.carrierId?.trim()) {
      return {
        docHeaderId: null,
        docNo: null,
        error: "ค่าขนส่งปลายทางต้องเลือกบริษัทขนส่ง",
      };
    }
    const goodsNet = roundMoney(
      lines.reduce((sum, line) => sum + line.lineTotal, 0),
    );
    const vatSummary = computeVendorPayable({
      goodsNet,
      originFreight: freightCostNormalized,
      freightTaxMode,
      vatType: resolvedVatType,
    });

    // Header money: prefer manual AI VAT Analysis overrides when provided
    const overrideNet =
      ledgerOverrides && Number.isFinite(Number(ledgerOverrides.netBeforeVat))
        ? roundMoney(Number(ledgerOverrides.netBeforeVat))
        : null;
    const overrideVat =
      ledgerOverrides && Number.isFinite(Number(ledgerOverrides.vatAmount))
        ? roundMoney(Number(ledgerOverrides.vatAmount))
        : null;
    const overrideGrand =
      ledgerOverrides && Number.isFinite(Number(ledgerOverrides.grandTotal))
        ? roundMoney(Number(ledgerOverrides.grandTotal))
        : null;

    const netBeforeVat = overrideNet ?? roundMoney(vatSummary.preVatAmount);
    const vatAmountPersisted = overrideVat ?? roundMoney(vatSummary.vatAmount);
    const grandTotal = overrideGrand ?? roundMoney(vatSummary.grandTotal);
    const totalAmountHeader =
      resolvedVatType === "INCLUSIVE"
        ? grandTotal
        : netBeforeVat;

    // ส่วนต่างปัดเศษ: Manual/override Grand − ยอดคำนวณจากผลรวมรายการ (+ VAT)
    const roundingDifference = roundMoney(
      ledgerOverrides?.roundingDifference != null &&
        Number.isFinite(Number(ledgerOverrides.roundingDifference))
        ? Number(ledgerOverrides.roundingDifference)
        : grandTotal - roundMoney(vatSummary.grandTotal),
    );

    // TODO (Phase X - GL Integration): ดึงค่า GL_ROUNDING_EXPENSE_ACC หรือ GL_ROUNDING_INCOME_ACC จาก system_settings
    // หาก rounding_difference > 0 ให้บันทึกเข้าบัญชีค่าใช้จ่ายเบ็ดเตล็ด
    // หาก rounding_difference < 0 ให้บันทึกเข้าบัญชีรายได้เบ็ดเตล็ด
    // (Future-proof สำหรับ General Ledger / GAAP-TFRS — ยังไม่ลง DR/CR ในเฟสนี้)

    const docNo = documentRef?.trim() || `REC-${Date.now()}`;
    const isValidIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(documentDate?.trim() ?? "");
    const docDate = isValidIsoDate
      ? documentDate.trim()
      : new Date().toISOString().slice(0, 10);

    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { docHeaderId: null, docNo: null, error: owner.error };
    }

    const runningPrefix =
      DOCUMENT_TYPE_PREFIX[resolvedDocType as DocumentType] ?? "APT";
    const paymentStatus = resolveInitialPaymentStatus(resolvedDocType);
    const issuedStatus = resolveIssuedDocumentStatus(resolvedDocType);
    const vendorInvoiceNote = `อ้างอิงบิลซัพพลายเออร์: ${docNo}`;
    const resolvedAttachmentUrl = attachmentUrl?.trim() || null;
    const ledgerProductIds = [
      ...new Set(lines.map((line) => line.row.matchedProduct!.id)),
    ];
    const { factors: uomFactorByProductId, error: uomFactorError } =
      await loadUomConversionFactorByProductId(supabaseAdmin, ledgerProductIds);
    if (uomFactorError) {
      return { docHeaderId: null, docNo: null, error: uomFactorError };
    }

    const ledgerLines = lines.map((line) => {
      const proratedFreight = proratedFreightByLineKey.get(line.row.lineKey) ?? 0;
      const landedUnitCost =
        landedUnitCostByLineKey.get(line.row.lineKey) ?? 0;
      const productId = line.row.matchedProduct!.id;
      const converted = applyPurchaseUomConversion({
        purchaseQty: line.qty,
        purchaseUnitCost: landedUnitCost,
        conversionFactor: resolveConversionFactor(
          line.row.conversionFactor ?? uomFactorByProductId.get(productId) ?? 1,
        ),
      });
      return {
        product_id: productId,
        qty: toNumeric14_4(converted.ledgerQty),
        unit_cost: toNumeric14_4(converted.unitCostBase),
        notes_detail: `Vendor SKU: ${line.row.raw_vendor_sku} | unit_cost_base=${converted.unitCostBase.toFixed(4)} | purchase_qty=${line.qty} | ledger_qty=${converted.ledgerQty} | uom_factor=${converted.factor} | prorated_freight=${proratedFreight.toFixed(2)}`,
      };
    });

    const maTargets = lines.filter(
      (line) => !line.row.isFoc && line.row.matchedProduct?.id,
    );
    const maProductIds =
      maTargets.length > 0
        ? [...new Set(maTargets.map((line) => line.row.matchedProduct!.id))]
        : [];
    let previousCostById = new Map<string, number>();
    let costUpdates: Array<{ product_id: string; cost_price: number }> = [];

    if (maProductIds.length > 0) {
      const { balances, error: balanceError } = await fetchOnHandQtyByProductIds(
        supabaseAdmin,
        maProductIds,
      );
      if (balanceError) {
        return { docHeaderId: null, docNo: null, error: balanceError };
      }

      const { data: productCosts, error: productCostError } = await supabaseAdmin
        .from("products")
        .select("id, cost_price")
        .in("id", maProductIds);

      if (productCostError) {
        return {
          docHeaderId: null,
          docNo: null,
          error: productCostError.message ?? "ดึงต้นทุนสินค้าปัจจุบันไม่สำเร็จ",
        };
      }

      const currentCostById = new Map(
        (productCosts ?? []).map((row) => [
          String(row.id),
          Number(row.cost_price ?? 0),
        ]),
      );
      previousCostById = currentCostById;
      const virtualQty = new Map(balances);
      const virtualCost = new Map(currentCostById);
      const maCostByProductId = new Map<string, number>();

      for (const line of maTargets) {
        const productId = line.row.matchedProduct!.id;
        const landedUnitCost =
          landedUnitCostByLineKey.get(line.row.lineKey) ?? line.unitCostPrice;
        const converted = applyPurchaseUomConversion({
          purchaseQty: line.qty,
          purchaseUnitCost: landedUnitCost,
          conversionFactor: resolveConversionFactor(
            line.row.conversionFactor ?? uomFactorByProductId.get(productId) ?? 1,
          ),
        });
        const resolved = resolveLppFromUnitCostPrice(converted.unitCostBase);
        if (resolved == null) continue;
        const onHand = virtualQty.get(productId) ?? 0;
        const currentAvg = virtualCost.get(productId) ?? 0;
        const blended = calculateMovingAverageUnitCost(
          onHand,
          currentAvg,
          converted.ledgerQty,
          resolved,
        );
        virtualQty.set(productId, onHand + converted.ledgerQty);
        virtualCost.set(productId, blended);
        maCostByProductId.set(productId, blended);
      }

      costUpdates = [...maCostByProductId.entries()].map(
        ([productId, costPrice]) => ({
          product_id: productId,
          cost_price: costPrice,
        }),
      );
    }

    const { data: generatedNo, error: numberError } = await supabaseAdmin.rpc(
      "generate_document_no",
      { p_doc_type: runningPrefix, p_doc_date: docDate },
    );
    const officialDocNo = typeof generatedNo === "string" ? generatedNo.trim() : "";
    if (numberError || !officialDocNo) {
      return {
        docHeaderId: null,
        docNo: null,
        error: numberError?.message ?? "สร้างเลขที่เอกสารรับสินค้าไม่สำเร็จ",
      };
    }

    const freightColumns = buildFreightDocumentColumns({
      originFreight: freightCostNormalized,
      freightTaxMode,
      destFreight: destFreightNormalized,
      carrierId: freightContext?.carrierId,
      carrierTrackingNo: freightContext?.carrierTrackingNo,
      vendorGrandTotal: grandTotal,
    });
    const originFreightAmount = Number(freightColumns.freight_cost || 0);
    const destFreightAmount = Number(freightColumns.dest_freight_cost || 0);
    const discountAmountSafe = Number(discountAmount || 0);
    const subTotalSafe = Number(subTotal || 0);
    const grandTotalSafe = Number(grandTotal || 0);
    const taxAmountSafe = Number(vatAmountPersisted || 0);
    const taxRateSafe = Number(vatRate || 0);
    const paymentStatusSafe = paymentStatus || "UNPAID";
    const statusSafe = issuedStatus || "ISSUED";
    const destFreightPaidStatus = destFreightAmount > 0 ? "UNPAID" : "NONE";
    const detailRows = lines.map((line, index) => {
      const unitCostWithFreight =
        landedUnitCostByLineKey.get(line.row.lineKey) ?? line.unitCostPrice;
      const description = (
        line.row.raw_description ??
        line.row.matchedProduct!.name ??
        ""
      ).slice(0, 255);
      return {
        product_id: line.row.matchedProduct!.id,
        description,
        qty: line.qty,
        uom_used: line.row.purchaseUomCode || DEFAULT_PURCHASE_UOM_CODE,
        unit_price: line.unitPrice,
        unit_cost_price: unitCostWithFreight,
        discount_text: line.row.discount_text?.trim() || null,
        discount_amount: line.discountAmount,
        line_total: line.lineTotal,
        prorated_freight: proratedFreightByLineKey.get(line.row.lineKey) ?? 0,
        sort_order: index,
      };
    });

    const { data: createdDoc, error: docError } = await supabaseAdmin
      .from("documents")
      .insert({
        doc_no: officialDocNo,
        doc_type: resolvedDocType,
        status: statusSafe,
        doc_date: docDate,
        contact_id: vendorId,
        contact_person_id: null,
        sub_total: subTotalSafe,
        discount_amount: discountAmountSafe,
        tax_rate: taxRateSafe,
        tax_amount: taxAmountSafe,
        grand_total: grandTotalSafe,
        vat_type: resolvedVatType || "NONE",
        vat_rate: taxRateSafe,
        total_amount: Number(totalAmountHeader || 0),
        net_before_vat: Number(netBeforeVat || 0),
        vat_amount: taxAmountSafe,
        rounding_difference: Number(roundingDifference || 0),
        deposit_deducted: 0,
        wht_amount: 0,
        wht_rate: 0,
        discount_text: billDiscountText?.trim() || null,
        payment_status: paymentStatusSafe,
        paid_amount: Number(paymentStatusSafe === "PAID" ? grandTotalSafe : 0),
        notes: vendorInvoiceNote,
        reference_no: docNo,
        ...freightColumns,
        freight_cost: originFreightAmount,
        dest_freight_cost: destFreightAmount,
        separate_freight_amount: Number(freightColumns.separate_freight_amount || 0),
        billing_note_eligible_amount: Number(
          freightColumns.billing_note_eligible_amount || 0,
        ),
        freight_paid_separately: freightColumns.freight_paid_separately === true,
        dest_freight_paid_status: destFreightPaidStatus,
        carrier_receipt_status: freightColumns.carrier_receipt_status || "PENDING",
        attachment_url: resolvedAttachmentUrl,
        attached_file_url: resolvedAttachmentUrl,
        original_file_name: resolvedAttachmentUrl
          ? resolvedAttachmentUrl.split("/").pop() || null
          : null,
        created_by: owner.userId,
        updated_at: new Date().toISOString(),
      })
      .select("id, doc_no")
      .single();

    if (docError || !createdDoc) {
      return {
        docHeaderId: null,
        docNo: null,
        error: isUniqueViolation(docError)
          ? `เลขที่เอกสาร "${officialDocNo}" ถูกใช้แล้ว — กรุณาลองบันทึกอีกครั้ง`
          : (docError?.message ?? "สร้างหัวเอกสาร (documents) ไม่สำเร็จ"),
      };
    }

    const headerId = String(createdDoc.id ?? "").trim();
    const persistedDocNo = String(createdDoc.doc_no ?? "").trim();
    if (!headerId || !persistedDocNo) {
      if (headerId) await rollbackOcrGoodsReceipt(supabaseAdmin, headerId);
      return {
        docHeaderId: null,
        docNo: null,
        error: "หัวเอกสารไม่คืน id หรือเลขที่เอกสาร — ยกเลิกก่อนลงรายการและสต็อก",
      };
    }

    const { data: legacyHeader, error: legacyError } = await supabaseAdmin
      .from("doc_headers")
      .insert({
        id: headerId,
        doc_no: docNo,
        doc_type: resolvedDocType,
        doc_date: docDate,
        contact_id: vendorId,
        sub_total: subTotalSafe,
        discount_amount: discountAmountSafe,
        tax_rate: taxRateSafe,
        tax_amount: taxAmountSafe,
        grand_total: grandTotalSafe,
        freight_cost: originFreightAmount,
        payment_status: paymentStatusSafe,
        created_by: owner.userId,
      })
      .select("id, doc_no")
      .single();

    if (legacyError || !legacyHeader || String(legacyHeader.id ?? "") !== headerId) {
      await rollbackOcrGoodsReceipt(supabaseAdmin, headerId);
      return {
        docHeaderId: null,
        docNo: null,
        error: isUniqueViolation(legacyError)
          ? `เลขที่เอกสาร "${docNo}" ลงวันที่ ${docDate} ถูกบันทึกเข้าระบบแล้วสำหรับผู้จำหน่ายรายนี้ — กรุณาตรวจสอบอีกครั้ง`
          : (legacyError?.message ?? "สร้างหัวเอกสาร (doc_headers) ไม่สำเร็จ"),
      };
    }

    const { error: legacyDetailError } = await supabaseAdmin.from("doc_details").insert(
      detailRows.map((line) => ({
        doc_header_id: headerId,
        product_id: line.product_id,
        description: line.description,
        qty: line.qty,
        uom_used: line.uom_used,
        unit_price: line.unit_price,
        unit_cost_price: line.unit_cost_price,
        discount_text: line.discount_text ?? "",
        discount_amount: line.discount_amount,
        line_total: line.line_total,
      })),
    );
    if (legacyDetailError) {
      await rollbackOcrGoodsReceipt(supabaseAdmin, headerId);
      return {
        docHeaderId: null,
        docNo: null,
        error: legacyDetailError.message ?? "บันทึกรายการ (doc_details) ไม่สำเร็จ",
      };
    }

    const { error: itemError } = await supabaseAdmin.from("document_items").insert(
      detailRows.map((line) => ({
        document_id: headerId,
        product_id: line.product_id,
        description: line.description,
        qty: line.qty,
        uom_used: line.uom_used,
        unit_price: line.unit_price,
        unit_cost_price: line.unit_cost_price,
        discount_text: line.discount_text,
        discount_amount: line.discount_amount,
        line_total: line.line_total,
        prorated_freight: line.prorated_freight,
        sort_order: line.sort_order,
      })),
    );
    if (itemError) {
      await rollbackOcrGoodsReceipt(supabaseAdmin, headerId);
      return {
        docHeaderId: null,
        docNo: null,
        error: itemError.message ?? "บันทึกรายการ (document_items) ไม่สำเร็จ",
      };
    }

    const ledgerPayload = ledgerLines
      .filter((line) => Boolean(line.product_id))
      .map((line) => ({
        product_id: line.product_id,
        doc_header_id: headerId,
        document_id: headerId,
        trans_type: "IN",
        qty: line.qty,
        unit_cost: line.unit_cost,
        notes: `รับสินค้าจากเอกสาร ${docNo} (${persistedDocNo}) — ${line.notes_detail}`.slice(
          0,
          255,
        ),
      }));

    if (ledgerPayload.length > 0) {
      const { error: ledgerError } = await supabaseAdmin
        .from("inventory_ledger")
        .insert(ledgerPayload);
      if (ledgerError) {
        await rollbackOcrGoodsReceipt(supabaseAdmin, headerId);
        return {
          docHeaderId: null,
          docNo: null,
          error: ledgerError.message ?? "บันทึกสต็อก (inventory_ledger) ไม่สำเร็จ",
        };
      }
    }

    for (const update of costUpdates) {
      const { error: costError } = await supabaseAdmin
        .from("products")
        .update({ cost_price: update.cost_price })
        .eq("id", update.product_id);
      if (costError) {
        for (const prior of costUpdates) {
          const previous = previousCostById.get(prior.product_id);
          if (previous == null) continue;
          await supabaseAdmin
            .from("products")
            .update({ cost_price: previous })
            .eq("id", prior.product_id);
        }
        await rollbackOcrGoodsReceipt(supabaseAdmin, headerId);
        return {
          docHeaderId: null,
          docNo: null,
          error: costError.message ?? "อัปเดตต้นทุนเฉลี่ย (products.cost_price) ไม่สำเร็จ",
        };
      }
    }

    const billError = await linkProcurementBills(supabaseAdmin, {
      documentId: headerId,
      docNo: persistedDocNo,
      docHeaderId: headerId,
      bills: billAttachments,
    });

    revalidatePath("/purchases");
    revalidatePath(`/purchases/${encodeURIComponent(persistedDocNo)}`);
    revalidatePath("/inventory/ledger");

    return {
      docHeaderId: headerId,
      docNo: persistedDocNo,
      error: billError
        ? `เอกสารถูกบันทึกแล้ว แต่ผูกไฟล์บิลไม่สำเร็จ: ${billError}`
        : null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "บันทึกรับสินค้าเข้าคลังไม่สำเร็จ";
    return { docHeaderId: null, docNo: null, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* saveManualGoodsReceipt                                                    */
/* -------------------------------------------------------------------------- */

export type ManualGoodsReceiptLineInput = {
  product_id: string;
  qty: number;
  /**
   * Gross unit price/cost as entered by staff (before VAT strip / bill discount).
   * Server recomputes net unit cost via Apportionment Math Engine.
   */
  unit_cost: number;
  description?: string | null;
  sku?: string | null;
  purchaseUomCode?: string | null;
  conversionFactor?: number | null;
  /** ของแถม — ตั้งหนี้เป็น 0 แต่จำนวนยังเข้าฐานต้นทุนเฉลี่ย TAS 2 */
  isFoc?: boolean;
  /** ลำดับที่แสดงบนหน้าจอ เริ่มที่ 1 — บันทึกลง document_items.sort_order */
  sort_order?: number | null;
};

export type SaveManualGoodsReceiptInput = {
  vendorId: string;
  /** ISO `YYYY-MM-DD` */
  docDate: string;
  /** Required vendor invoice / reference number. */
  documentRef: string;
  docType?: GoodsReceiptDocType;
  vatType?: VatCalculationType;
  /** Bill discount text e.g. "10%" or "500". */
  discountText?: string | null;
  /** ค่าขนส่งต้นทาง (Freight-In) — รวมในหนี้ผู้ขาย และกระจายลงต้นทุน */
  freightCost?: number | null;
  freightTaxMode?: FreightTaxMode | null;
  destFreightCost?: number | null;
  carrierId?: string | null;
  carrierTrackingNo?: string | null;
  /** ERP lifecycle — ledger ถูกโพสต์เฉพาะ ISSUED / PAID */
  status?: "DRAFT" | "ISSUED" | "PAID";
  lines: ManualGoodsReceiptLineInput[];
  bills?: ProcurementBillSet | null;
};

export type SaveManualGoodsReceiptResult = {
  data: {
    document_id: string;
    doc_no: string;
    ledger_count: number;
  } | null;
  error: string | null;
};

function parseManualGoodsReceiptRpc(rpcData: unknown): {
  success: boolean;
  error: string | null;
  documentId: string | null;
  docNo: string | null;
  ledgerCount: number;
} {
  if (typeof rpcData === "string") {
    const trimmed = rpcData.trim();
    if (!trimmed) {
      return {
        success: false,
        error: "RPC save_manual_goods_receipt_transaction ไม่คืนผลลัพธ์",
        documentId: null,
        docNo: null,
        ledgerCount: 0,
      };
    }
    try {
      return parseManualGoodsReceiptRpc(JSON.parse(trimmed) as unknown);
    } catch {
      return {
        success: false,
        error: trimmed,
        documentId: null,
        docNo: null,
        ledgerCount: 0,
      };
    }
  }

  if (rpcData == null || typeof rpcData !== "object") {
    return {
      success: false,
      error: "RPC save_manual_goods_receipt_transaction ไม่คืนผลลัพธ์",
      documentId: null,
      docNo: null,
      ledgerCount: 0,
    };
  }

  const payload = rpcData as Record<string, unknown>;
  const errorRaw = payload.error ?? payload.message ?? null;
  const error =
    errorRaw != null && String(errorRaw).trim() ? String(errorRaw).trim() : null;
  const successFlag = payload.success;
  const success =
    successFlag === false || successFlag === "false" ? false : error == null;
  const ledgerCount = Number(payload.ledger_count ?? 0);

  return {
    success,
    error,
    documentId:
      payload.document_id != null ? String(payload.document_id) : null,
    docNo: payload.doc_no != null ? String(payload.doc_no) : null,
    ledgerCount: Number.isFinite(ledgerCount) ? ledgerCount : 0,
  };
}

/**
 * Manual Goods Receipt (no OCR). Accounting stays in TypeScript.
 * Header, lines, inventory IN, and moving-average cost commit together in
 * `save_manual_goods_receipt_transaction`. Ledger posts only for ISSUED / PAID.
 * Service Role only — Zero Client-Side Fetching.
 */
export async function saveManualGoodsReceipt(
  input: SaveManualGoodsReceiptInput,
): Promise<SaveManualGoodsReceiptResult> {
  const supabaseAdmin = createSupabaseAdminClient();

  try {
    const vendorId = input?.vendorId?.trim() ?? "";
    const lines = Array.isArray(input?.lines) ? input.lines : [];
    const documentRef = input?.documentRef?.trim() ?? "";
    const isValidIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(input?.docDate?.trim() ?? "");
    const docDate = isValidIsoDate
      ? input.docDate.trim()
      : new Date().toISOString().slice(0, 10);

    const resolvedDocType: GoodsReceiptDocType = isGoodsReceiptDocType(
      String(input?.docType ?? "AP_TAX"),
    )
      ? (input.docType as GoodsReceiptDocType)
      : "AP_TAX";
    const resolvedVatType: VatCalculationType = isVatCalculationType(
      String(input?.vatType ?? "NONE"),
    )
      ? (input.vatType as VatCalculationType)
      : "NONE";
    const requestedStatus = String(input?.status ?? "").trim().toUpperCase();
    const payloadStatus: "DRAFT" | "ISSUED" | "PAID" =
      requestedStatus === "DRAFT" ||
      requestedStatus === "ISSUED" ||
      requestedStatus === "PAID"
        ? requestedStatus
        : "ISSUED";
    const vatRate = resolvedVatType === "NONE" ? 0 : 7;
    const discountText = input?.discountText?.trim() || null;
    const freightCostNormalized = roundMoney(
      Math.max(0, Number(input?.freightCost) || 0),
    );
    const freightTaxMode = normalizeFreightTaxMode(input?.freightTaxMode);
    const destFreightNormalized = roundMoney(
      Math.max(0, Number(input?.destFreightCost) || 0),
    );
    if (destFreightNormalized > 0 && !input?.carrierId?.trim()) {
      return { data: null, error: "ค่าขนส่งปลายทางต้องเลือกบริษัทขนส่ง" };
    }

    if (!vendorId) {
      return { data: null, error: "กรุณาเลือกผู้จำหน่าย (Vendor)" };
    }
    if (!documentRef) {
      return { data: null, error: "กรุณากรอกเลขที่เอกสารอ้างอิง (Vendor Ref No.)" };
    }
    if (lines.length === 0) {
      return { data: null, error: "กรุณาเพิ่มรายการสินค้ารับเข้าอย่างน้อย 1 รายการ" };
    }

    for (const [index, line] of lines.entries()) {
      if (!line.product_id?.trim()) {
        return { data: null, error: `รายการที่ ${index + 1}: ไม่มี product_id` };
      }
      if (toNumeric14_4(line.qty) <= 0) {
        return {
          data: null,
          error: `รายการที่ ${index + 1}: จำนวนต้องมากกว่า 0`,
        };
      }
      if (!Number.isFinite(line.unit_cost) || line.unit_cost < 0) {
        return {
          data: null,
          error: `รายการที่ ${index + 1}: ต้นทุนต่อหน่วยไม่ถูกต้อง`,
        };
      }
    }

    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { data: null, error: owner.error };
    }

    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("id", vendorId)
      .contains("contact_roles", ["Vendor"])
      .eq("is_active", true)
      .maybeSingle();

    if (vendorError) {
      return { data: null, error: vendorError.message };
    }
    if (!vendor) {
      return { data: null, error: "ไม่พบผู้จำหน่าย หรือถูกปิดใช้งาน" };
    }

    const productIds = [
      ...new Set(lines.map((line) => line.product_id.trim()).filter(Boolean)),
    ];
    const { data: products, error: productsError } = await supabaseAdmin
      .from("products")
      .select(
        `
        id,
        name,
        sku,
        base_uom,
        is_active,
        product_models:model_id (
          is_service
        )
      `,
      )
      .in("id", productIds);

    if (productsError) {
      return { data: null, error: productsError.message };
    }

    type ProductModelJoin = {
      is_service?: boolean | null;
    };
    type ProductRow = {
      id: string;
      name: string | null;
      sku: string | null;
      base_uom: string | null;
      is_active: boolean | null;
      product_models: ProductModelJoin | ProductModelJoin[] | null;
    };

    const productById = new Map<string, ProductRow>(
      ((products ?? []) as ProductRow[]).map((row) => [String(row.id), row]),
    );
    for (const productId of productIds) {
      const product = productById.get(productId);
      if (!product || product.is_active === false) {
        return {
          data: null,
          error: `ไม่พบสินค้าในระบบ หรือถูกปิดใช้งาน: ${productId}`,
        };
      }
    }

    const preparedLines = lines.map((line, index) => {
      const productId = line.product_id.trim();
      const product = productById.get(productId)!;
      const modelJoin = Array.isArray(product.product_models)
        ? (product.product_models[0] ?? null)
        : product.product_models;
      const qty = toNumeric14_4(line.qty);
      const isFoc = line.isFoc === true;
      const unitPrice = isFoc ? 0 : Number(line.unit_cost) || 0;
      const lineKey = `line-${index}-${productId}`;
      return {
        lineKey,
        isFoc,
        product_id: productId,
        description: (
          line.description?.trim() ||
          String(product.name ?? "") ||
          ""
        ).slice(0, 255),
        sku: line.sku?.trim() || String(product.sku ?? ""),
        qty,
        uom_used:
          String(line.purchaseUomCode ?? "").trim().toUpperCase() ||
          DEFAULT_PURCHASE_UOM_CODE,
        conversionFactor: resolveConversionFactor(line.conversionFactor ?? 1),
        unitPrice,
        sort_order: (() => {
          const requested = Number(line.sort_order);
          return Number.isInteger(requested) && requested > 0
            ? requested
            : index + 1;
        })(),
        is_service: modelJoin?.is_service === true,
      };
    });

    const apportionmentItems: ApportionmentItem[] = preparedLines.map((line) => ({
      id: line.lineKey,
      unitPrice: line.unitPrice,
      qty: line.qty,
      discountText: null,
      isFoc: line.isFoc,
    }));

    // Cost path — INCLUSIVE strips VAT before bill-discount apportionment (LPP).
    const costByLineKey = new Map(
      calculateNetCostApportionment(apportionmentItems, discountText, {
        vatType: resolvedVatType,
        vatRate,
      }).map((result) => [result.id, result]),
    );

    // Invoice path — as-entered amounts for document money / VAT summary.
    const invoiceByLineKey = new Map(
      calculateNetCostApportionment(apportionmentItems, discountText, {
        vatType: "NONE",
        vatRate: 0,
      }).map((result) => [result.id, result]),
    );

    const normalizedLines = preparedLines.map((line) => {
      const cost = costByLineKey.get(line.lineKey);
      const invoice = invoiceByLineKey.get(line.lineKey);
      const invoiceLineTotal = roundMoney(invoice?.finalLineTotal ?? 0);
      const unitCostPrice = roundTo4Decimals(cost?.finalUnitCost ?? 0);
      const discountAmount = roundMoney(line.unitPrice * line.qty - invoiceLineTotal);
      return {
        lineKey: line.lineKey,
        product_id: line.product_id,
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        uom_used: line.uom_used,
        conversionFactor: line.conversionFactor,
        unit_price: roundMoney(line.unitPrice),
        unit_cost: unitCostPrice,
        discount_amount: discountAmount,
        line_total: invoiceLineTotal,
        sort_order: line.sort_order,
        is_service: line.is_service,
        isFoc: line.isFoc,
      };
    });

    const landedCostByLineKey = new Map(
      calculateLandedCost(
        freightCostNormalized,
        normalizedLines.map((line) => {
          const costLineTotal =
            costByLineKey.get(line.lineKey)?.finalLineTotal ??
            roundTo4Decimals(line.unit_cost * line.qty);
          return {
            id: line.lineKey,
            qty: line.qty,
            lineNetAmount: costLineTotal,
            unitNetCost: line.unit_cost,
            isFoc: line.isFoc,
          };
        }),
        {
          vatType: resolvedVatType,
          vatRate,
          freightTaxMode,
          destFreightCost: destFreightNormalized,
        },
      ).map((row) => [row.id, row]),
    );

    const proratedFreightByLineKey = new Map(
      [...landedCostByLineKey.entries()].map(([id, row]) => [
        id,
        row.proratedFreight,
      ]),
    );

    const receiptLines = normalizedLines.map((line) => {
      const landed = landedCostByLineKey.get(line.lineKey);
      return {
        ...line,
        unit_cost: landed?.landedUnitCost ?? line.unit_cost,
      };
    });

    const subTotal = calculateApSubTotalWithFreight(
      receiptLines.map((line) => line.line_total),
      freightCostNormalized,
    );
    const discountAmount = roundMoney(
      receiptLines.reduce((sum, line) => sum + line.discount_amount, 0),
    );
    const vatSummary = computeVendorPayable({
      goodsNet: roundMoney(receiptLines.reduce((sum, line) => sum + line.line_total, 0)),
      originFreight: freightCostNormalized,
      freightTaxMode,
      vatType: resolvedVatType,
    });
    const grandTotal = roundMoney(vatSummary.grandTotal);

    const runningPrefix =
      DOCUMENT_TYPE_PREFIX[resolvedDocType as DocumentType] ?? "APT";
    const draftDocNo = generateDraftDocumentNo();
    const postLedger = shouldPostInventoryLedger(payloadStatus);
    const notes = `รับสินค้าแบบ Manual · อ้างอิงบิลซัพพลายเออร์: ${documentRef}`;
    const paymentStatus = resolveInitialPaymentStatus(resolvedDocType);
    const stockLines = postLedger
      ? receiptLines.filter((line) => !line.is_service)
      : [];

    let ledgerLines: Array<{
      product_id: string;
      qty: number;
      unit_cost: number;
      notes_detail: string;
    }> = [];
    let costUpdates: Array<{ product_id: string; cost_price: number }> = [];

    if (postLedger && stockLines.length > 0) {
      const ledgerProductIds = [
        ...new Set(stockLines.map((line) => line.product_id)),
      ];
      const { factors: uomFactorByProductId, error: uomFactorError } =
        await loadUomConversionFactorByProductId(
          supabaseAdmin,
          ledgerProductIds,
        );
      if (uomFactorError) {
        throw new Error(uomFactorError);
      }

      const { balances, error: balanceError } = await fetchOnHandQtyByProductIds(
        supabaseAdmin,
        ledgerProductIds,
      );
      if (balanceError) {
        throw new Error(balanceError);
      }

      const { data: productCosts, error: productCostError } = await supabaseAdmin
        .from("products")
        .select("id, cost_price")
        .in("id", ledgerProductIds);

      if (productCostError) {
        throw new Error(productCostError.message);
      }

      const currentCostById = new Map(
        (productCosts ?? []).map((row) => [
          String(row.id),
          Number(row.cost_price ?? 0),
        ]),
      );

      ledgerLines = stockLines.map((line) => {
        const proratedFreight = proratedFreightByLineKey.get(line.lineKey) ?? 0;
        const converted = applyPurchaseUomConversion({
          purchaseQty: toNumeric14_4(line.qty),
          purchaseUnitCost: line.unit_cost,
          conversionFactor: resolveConversionFactor(
            line.conversionFactor ?? uomFactorByProductId.get(line.product_id) ?? 1,
          ),
        });
        return {
          product_id: line.product_id,
          qty: toNumeric14_4(converted.ledgerQty),
          unit_cost: toNumeric14_4(converted.unitCostBase),
          notes_detail: `unit_cost_base=${converted.unitCostBase.toFixed(4)} | purchase_qty=${line.qty} | ledger_qty=${converted.ledgerQty} | uom_factor=${converted.factor} | prorated_freight=${proratedFreight.toFixed(2)} | SKU: ${line.sku || "-"}`,
        };
      });

      const virtualQty = new Map(balances);
      const virtualCost = new Map(currentCostById);
      const maCostByProductId = new Map<string, number>();

      for (const line of stockLines) {
        const converted = applyPurchaseUomConversion({
          purchaseQty: toNumeric14_4(line.qty),
          purchaseUnitCost: line.unit_cost,
          conversionFactor: resolveConversionFactor(
            line.conversionFactor ??
              uomFactorByProductId.get(line.product_id) ??
              1,
          ),
        });
        const resolved = resolveLppFromUnitCostPrice(converted.unitCostBase);
        if (resolved == null) continue;
        const onHand = virtualQty.get(line.product_id) ?? 0;
        const currentAvg = virtualCost.get(line.product_id) ?? 0;
        const blended = calculateMovingAverageUnitCost(
          onHand,
          currentAvg,
          converted.ledgerQty,
          resolved,
        );
        virtualQty.set(line.product_id, onHand + converted.ledgerQty);
        virtualCost.set(line.product_id, blended);
        maCostByProductId.set(line.product_id, blended);
      }

      costUpdates = [...maCostByProductId.entries()].map(
        ([productId, costPrice]) => ({
          product_id: productId,
          cost_price: costPrice,
        }),
      );
    }

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc(
      "save_manual_goods_receipt_transaction",
      {
        p_should_post_ledger: postLedger,
        p_running_prefix: runningPrefix,
        p_draft_doc_no: draftDocNo,
        p_doc_date: docDate,
        p_document_ref: documentRef,
        p_header: {
          doc_type: resolvedDocType,
          status: payloadStatus,
          contact_id: vendorId,
          contact_person_id: null,
          sub_total: subTotal,
          discount_amount: discountAmount,
          tax_rate: vatSummary.vatRate,
          tax_amount: vatSummary.vatAmount,
          grand_total: grandTotal,
          ...buildFreightDocumentColumns({
            originFreight: freightCostNormalized,
            freightTaxMode,
            destFreight: destFreightNormalized,
            carrierId: input?.carrierId,
            carrierTrackingNo: input?.carrierTrackingNo,
            vendorGrandTotal: grandTotal,
          }),
          vat_type: resolvedVatType,
          vat_rate: vatSummary.vatRate,
          total_amount:
            resolvedVatType === "INCLUSIVE"
              ? grandTotal
              : vatSummary.preVatAmount,
          net_before_vat: vatSummary.preVatAmount,
          vat_amount: vatSummary.vatAmount,
          discount_text: discountText,
          payment_status: paymentStatus,
          paid_amount: paymentStatus === "PAID" ? grandTotal : 0,
          notes,
          created_by: owner.userId,
        },
        p_items: receiptLines.map((line) => ({
          product_id: line.product_id,
          description: line.description,
          qty: toNumeric14_4(line.qty),
          uom_used: line.uom_used,
          unit_price: line.unit_price,
          unit_cost_price: line.unit_cost,
          discount_text: null,
          discount_amount: line.discount_amount,
          line_total: line.line_total,
          prorated_freight: proratedFreightByLineKey.get(line.lineKey) ?? 0,
          sort_order: line.sort_order,
        })),
        p_ledger_lines: ledgerLines,
        p_cost_updates: costUpdates,
      },
    );

    const parsed = parseManualGoodsReceiptRpc(rpcData);
    if (rpcError || !parsed.success || !parsed.documentId || !parsed.docNo) {
      return {
        data: null,
        error:
          rpcError?.message ??
          parsed.error ??
          "บันทึกรับสินค้าแบบ Manual ไม่สำเร็จ",
      };
    }

    const billError = await linkProcurementBills(supabaseAdmin, {
      documentId: parsed.documentId,
      bills: input.bills,
    });

    revalidatePath("/purchases");
    revalidatePath(`/purchases/${encodeURIComponent(parsed.docNo)}`);
    revalidatePath("/inventory/ledger");

    if (billError) {
      return {
        data: {
          document_id: parsed.documentId,
          doc_no: parsed.docNo,
          ledger_count: parsed.ledgerCount,
        },
        error: `เอกสารถูกบันทึกแล้ว แต่ผูกไฟล์บิลไม่สำเร็จ: ${billError}`,
      };
    }

    return {
      data: {
        document_id: parsed.documentId,
        doc_no: parsed.docNo,
        ledger_count: parsed.ledgerCount,
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "บันทึกรับสินค้าแบบ Manual ไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/*
 * NOTE: The old ad-hoc `createQuickProductForReceipt` (spun up a brand-new
 * dummy `product_models` shell per SKU) has been superseded by the proper
 * "Quick Create SKU" flow in `lib/actions/product.ts`
 * (`getModelsByVendor` + `getSizesByBrand` + `quickCreateSKU`), which adds
 * a color/size variant onto a REAL, brand/category-linked model and reuses
 * the same SKU formula as the full Product Matrix (`app/products/product-sku.ts`).
 * See `components/procurement/QuickCreateDialog.tsx` for the wired-up UI.
 */
