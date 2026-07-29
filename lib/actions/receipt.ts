"use server";

/**
 * Smart Goods Receipt — Server Actions.
 *
 * Zero Client-Side Fetching: `GoodsReceiptUI` never talks to Supabase
 * directly. Every read/write (OCR, vendor mapping lookup, pricing,
 * on-the-fly mapping) goes through these Server Actions using the
 * service-role admin client, same convention as `lib/actions/mapping.ts`.
 *
 * Architecture: `parseReceiptOcr` does NOT call Gemini directly from Node.
 * It converts the uploaded `File` to Base64 natively, then securely invokes
 * the `process-receipt-ocr` Supabase Edge Function (via the admin client's
 * `functions.invoke`, so `SUPABASE_SERVICE_ROLE_KEY` — not a browser
 * session — authorizes the call). The Edge Function (Deno) is the only
 * place that talks to the Gemini API — see
 * `supabase/functions/process-receipt-ocr/index.ts`.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  DOCUMENT_TYPE_PREFIX,
  GOODS_RECEIPT_DOC_TYPES,
  resolveInitialPaymentStatus,
  resolveIssuedDocumentStatus,
  type GoodsReceiptDocType,
} from "@/lib/constants/document";
import { calculateNetUnitCost } from "@/lib/utils/pricing";
import {
  calculateNetCostApportionment,
  type ApportionmentItem,
} from "@/lib/utils/accounting";
import {
  calculateDocumentSummary,
  isVatCalculationType,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import type { DocumentType } from "@/types/document";

function isGoodsReceiptDocType(value: string): value is GoodsReceiptDocType {
  return (GOODS_RECEIPT_DOC_TYPES as readonly string[]).includes(value);
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

/** UPPERCASE + trim + collapse spaces so OCR noise still matches stored SKUs. */
function normalizeVendorSku(sku: string): string {
  return (sku ?? "").trim().toUpperCase().replace(/\s+/g, " ");
}

/**
 * `supabase.functions.invoke()` reports a non-2xx response as a generic
 * `FunctionsHttpError` ("Edge Function returned a non-2xx status code") and
 * discards the body. The actual Thai/English message we care about lives in
 * `error.context` — the raw `Response` — as `{ error: string }` JSON. Try to
 * read it; fall back to the generic message if the body isn't JSON.
 */
async function extractEdgeFunctionErrorMessage(error: unknown): Promise<string> {
  const fallback =
    error instanceof Error
      ? error.message
      : "เรียก Edge Function process-receipt-ocr ไม่สำเร็จ";

  const context = (error as { context?: unknown })?.context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: string } | null;
      if (body?.error) return body.error;
    } catch {
      // Body wasn't JSON (e.g. Deno crash page) — keep the generic message.
    }
  }

  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Shared types                                                               */
/* -------------------------------------------------------------------------- */

/** One raw line as returned by the `process-receipt-ocr` Edge Function. */
export type RawOcrLine = {
  raw_vendor_sku: string;
  raw_description?: string | null;
  qty: number;
  unit_price: number;
  discount_text: string;
};

export type ReceiptProductSummary = {
  id: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
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
  discountAmountPerUnit: number;
  netCost: number;
  /** Free-of-Charge (ของแถม) — when true, Net Cost Apportionment forces cost = 0. */
  isFoc: boolean;
};

/* -------------------------------------------------------------------------- */
/* parseReceiptOcr (invokes process-receipt-ocr Edge Function)               */
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
 * Real Vision AI OCR — this Server Action never talks to Gemini itself. It
 * converts the uploaded `File` to Base64 and securely invokes the
 * `process-receipt-ocr` Supabase Edge Function, which owns the Gemini call.
 *
 * `FormData` (not a raw Base64 string) is required as the argument — Next.js
 * Server Actions serialize plain-object/array arguments through React's
 * Flight protocol, and a multi-MB Base64 string blows past its array
 * nesting / chunking limits ("Maximum array nesting exceeded"). `FormData`
 * (like `File`) is a special type Next.js streams natively without that
 * limit; the Base64 conversion happens here, server-side, from the `File`.
 *
 * Flow:
 * 1. Extract `vendorId` + `file` from the FormData.
 * 2. Convert `file` → Base64 (server-side, via `arrayBuffer()`).
 * 3. Invoke `process-receipt-ocr` with the service-role admin client, so
 *    `SUPABASE_SERVICE_ROLE_KEY` (never a browser session) authorizes the
 *    call and the Gemini API key stays inside the Edge Function's own env.
 * 4. Return the Edge Function's `data` (line items) + `document_number`
 *    (the header invoice number, extracted using the vendor's
 *    `ocr_pattern_config.invoice_no_hint` when configured).
 */
export async function parseReceiptOcr(
  formData: FormData,
): Promise<ParseReceiptOcrResult> {
  const vendorId = String(formData.get("vendorId") ?? "").trim();
  const file = formData.get("file");

  if (!vendorId) {
    return emptyParseReceiptOcrResult(
      "กรุณาเลือกผู้จำหน่าย (vendor) ก่อนอัปโหลดบิล",
    );
  }
  if (!(file instanceof File) || file.size === 0) {
    return emptyParseReceiptOcrResult("ไม่พบไฟล์รูปบิล กรุณาอัปโหลดไฟล์ก่อน");
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    // File → Base64 (server-side only, native Node.js Buffer)
    const buffer = Buffer.from(await file.arrayBuffer());
    const imageBase64 = buffer.toString("base64");

    const { data, error } = await supabaseAdmin.functions.invoke(
      "process-receipt-ocr",
      {
        body: { vendorId, imageBase64, mimeType: file.type },
      },
    );

    if (error) {
      // supabase-js only gives a generic "non-2xx status code" message here —
      // the Edge Function always returns a JSON `{ error }` body, so unwrap
      // it from `error.context` (the raw Response) to surface the real cause.
      return emptyParseReceiptOcrResult(
        await extractEdgeFunctionErrorMessage(error),
      );
    }

    const payload = data as {
      data?: RawOcrLine[];
      document_number?: string | null;
      document_date?: string | null;
      doc_type?: string | null;
      vat_type?: string | null;
      error?: string;
    } | null;

    if (!Array.isArray(payload?.data)) {
      return emptyParseReceiptOcrResult(
        payload?.error ?? "Edge Function ไม่คืนข้อมูลรายการ OCR กลับมา",
      );
    }

    return {
      data: payload.data,
      documentNumber: payload.document_number?.trim() || null,
      documentDate: payload.document_date?.trim() || null,
      docType: normalizeGoodsReceiptDocType(payload.doc_type),
      vatType: normalizeOcrVatType(payload.vat_type),
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "วิเคราะห์บิลด้วย OCR ไม่สำเร็จ";
    return emptyParseReceiptOcrResult(message);
  }
}

/* -------------------------------------------------------------------------- */
/* matchReceiptItemsToProducts                                               */
/* -------------------------------------------------------------------------- */

export type MatchReceiptItemsResult = {
  data: ReceiptLineRow[];
  error: string | null;
};

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
  const trimmedVendorId = vendorId?.trim() ?? "";
  if (!trimmedVendorId) {
    return { data: [], error: "กรุณาเลือกผู้จำหน่าย (vendor) ก่อน" };
  }
  if (!Array.isArray(items) || items.length === 0) {
    return { data: [], error: null };
  }

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const normalizedSkus = [
      ...new Set(
        items.map((item) => normalizeVendorSku(item.raw_vendor_sku)).filter(Boolean),
      ),
    ];

    const mappingByNormalizedSku = new Map<
      string,
      { id: string; product: ReceiptProductSummary }
    >();

    if (normalizedSkus.length > 0) {
      const { data, error } = await supabaseAdmin
        .from("vendor_product_mapping")
        .select(
          `
          id,
          vendor_sku,
          internal_product_id,
          product:products ( id, sku, name, color, size )
        `,
        )
        .eq("vendor_id", trimmedVendorId)
        .in("vendor_sku", normalizedSkus);

      if (error && error.code !== "42P01") {
        return { data: [], error: error.message };
      }

      type Row = {
        id: string;
        vendor_sku: string;
        internal_product_id: string;
        product: ReceiptProductSummary | ReceiptProductSummary[] | null;
      };

      for (const row of (data ?? []) as Row[]) {
        const product = Array.isArray(row.product)
          ? (row.product[0] ?? null)
          : row.product;
        if (!product) continue;
        mappingByNormalizedSku.set(normalizeVendorSku(row.vendor_sku), {
          id: row.id,
          product,
        });
      }
    }

    const rows: ReceiptLineRow[] = items.map((item, index) => {
      const normalizedSku = normalizeVendorSku(item.raw_vendor_sku);
      const match = mappingByNormalizedSku.get(normalizedSku) ?? null;
      const { unitCostPrice, discountAmountPerUnit } = calculateNetUnitCost(
        item.unit_price,
        item.discount_text,
      );

      return {
        lineKey: `${index}:${normalizedSku}:${item.unit_price}:${item.discount_text ?? ""}`,
        raw_vendor_sku: item.raw_vendor_sku,
        raw_description: item.raw_description ?? null,
        qty: Number(item.qty) || 0,
        unit_price: Number(item.unit_price) || 0,
        discount_text: item.discount_text ?? "",
        status: match ? "matched" : "unmatched",
        mappingId: match?.id ?? null,
        matchedProduct: match?.product ?? null,
        discountAmountPerUnit,
        netCost: unitCostPrice,
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

/* -------------------------------------------------------------------------- */
/* getInternalProductsForMatching                                            */
/* -------------------------------------------------------------------------- */

export type GetInternalProductsResult = {
  data: ReceiptProductSummary[];
  error: string | null;
};

/** Active products list — feeds the on-the-fly mapping Smart Combobox. */
export async function getInternalProductsForMatching(): Promise<GetInternalProductsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("products")
      .select("id, sku, name, color, size")
      .eq("is_active", true)
      .order("sku", { ascending: true });

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: (data ?? []) as ReceiptProductSummary[], error: null };
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
  const vendorId = input.vendorId?.trim() ?? "";
  const vendorSku = normalizeVendorSku(input.vendorSku ?? "");
  const internalProductId = input.internalProductId?.trim() ?? "";

  if (!vendorId) return { mappingId: null, product: null, error: "กรุณาเลือกผู้จำหน่าย" };
  if (!internalProductId)
    return { mappingId: null, product: null, error: "กรุณาเลือกสินค้าภายใน" };
  if (!vendorSku)
    return { mappingId: null, product: null, error: "รหัสสินค้าโรงงานว่างเปล่า" };

  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("vendor_product_mapping")
      .upsert(
        {
          vendor_id: vendorId,
          vendor_sku: vendorSku,
          vendor_product_name: input.vendorProductName?.trim() || null,
          vendor_uom: "ตัว",
          internal_product_id: internalProductId,
          conversion_factor: 1,
        },
        { onConflict: "vendor_id,vendor_sku" },
      )
      .select(
        `
        id,
        product:products ( id, sku, name, color, size )
      `,
      )
      .single();

    if (error) {
      return { mappingId: null, product: null, error: error.message, code: error.code };
    }

    type Row = {
      id: string;
      product: ReceiptProductSummary | ReceiptProductSummary[] | null;
    };
    const row = data as Row;
    const product = Array.isArray(row.product)
      ? (row.product[0] ?? null)
      : row.product;

    return { mappingId: row.id, product, error: null };
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

/** Round to 2 decimal places for DECIMAL(12,2) columns (doc_headers/doc_details). */
function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

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
 * `finalUnitCost` is written back to `products.cost_price` (Last Purchase
 * Price / LPP) via the same admin client — master data stays in sync with
 * the true net receipt cost without any client-side Supabase calls.
 *
 * `vendorId` is intentionally NOT a parameter — it's derived from each row's
 * `mappingId` (`vendor_product_mapping.vendor_id`), the same Ground Truth
 * already used to resolve the match. All rows must resolve to the SAME
 * vendor (one receipt document = one vendor), same convention as `doc_headers.contact_id`
 * and Phase 4 `documents.contact_id`.
 *
 * Note: `supabase-js` REST calls cannot share a single DB transaction across
 * three separate inserts. This uses sequential inserts with a best-effort
 * compensating rollback (delete what was already written) if a later step
 * fails. For guaranteed atomicity, wrap this in a Postgres `plpgsql` RPC
 * function instead — flagged here as a recommended follow-up, not yet done.
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
export async function saveGoodsReceiptToLedger(
  rows: ReceiptLineRow[],
  documentRef: string,
  documentDate: string,
  billDiscountText?: string | null,
  docType: GoodsReceiptDocType = "AP_TAX",
  vatType: VatCalculationType = "NONE",
  attachmentUrl?: string | null,
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
      rows.map((row) => [row.lineKey, Math.max(0, Math.round(Number(row.qty) || 0))]),
    );

    const zeroQtyRow = rows.find((row) => (qtyByLineKey.get(row.lineKey) ?? 0) <= 0);
    if (zeroQtyRow) {
      return {
        docHeaderId: null,
        docNo: null,
        error: `รายการ "${zeroQtyRow.raw_vendor_sku}" มีจำนวน (qty) ไม่ถูกต้อง`,
      };
    }

    // Recompute net pricing server-side via the Net Cost Apportionment
    // engine — never trust client-supplied netCost.
    // INCLUSIVE: strip VAT 7% from unit prices BEFORE line/bill discount so
    // LPP (`products.cost_price`) is true vatable cost.
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

    // Invoice-facing line totals (as printed) — no VAT strip; used for document money + VAT summary.
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
      const lineTotal = roundMoney(invoiceApportioned?.finalLineTotal ?? 0);
      const unitCostPrice = roundMoney(costApportioned?.finalUnitCost ?? 0);
      const discountAmount = roundMoney(unitPrice * qty - lineTotal);
      return { row, qty, unitPrice, unitCostPrice, discountAmount, lineTotal };
    });

    const subTotal = roundMoney(
      lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0),
    );
    const discountAmount = roundMoney(
      lines.reduce((sum, line) => sum + line.discountAmount, 0),
    );

    const vatSummary = calculateDocumentSummary({
      lineTotals: lines.map((line) => line.lineTotal),
      discountText: null,
      vatType: resolvedVatType,
      vatRate,
    });
    const grandTotal = roundMoney(vatSummary.grand_total);

    const docNo = documentRef?.trim() || `REC-${Date.now()}`;
    const isValidIsoDate = /^\d{4}-\d{2}-\d{2}$/.test(documentDate?.trim() ?? "");
    const docDate = isValidIsoDate
      ? documentDate.trim()
      : new Date().toISOString().slice(0, 10);

    // 1. doc_headers — legacy financial document (keeps vendor invoice identity)
    const { data: docHeader, error: docHeaderError } = await supabaseAdmin
      .from("doc_headers")
      .insert({
        doc_no: docNo,
        doc_type: resolvedDocType,
        doc_date: docDate,
        contact_id: vendorId,
        sub_total: subTotal,
        discount_amount: discountAmount,
        grand_total: grandTotal,
        payment_status: resolveInitialPaymentStatus(resolvedDocType),
      })
      .select("id, doc_no")
      .single();

    if (docHeaderError || !docHeader) {
      const isDuplicateDoc = docHeaderError?.code === "23505";
      return {
        docHeaderId: null,
        docNo: null,
        error: isDuplicateDoc
          ? `เลขที่เอกสาร "${docNo}" ลงวันที่ ${docDate} ถูกบันทึกเข้าระบบแล้วสำหรับผู้จำหน่ายรายนี้ — กรุณาตรวจสอบอีกครั้ง`
          : (docHeaderError?.message ?? "สร้างเอกสารรับสินค้า (doc_headers) ไม่สำเร็จ"),
      };
    }

    const docHeaderId = (docHeader as { id: string; doc_no: string }).id;

    // 2. doc_details — line-level cost/qty (unit_cost_price via VAT-aware apportionment)
    const docDetailsPayload = lines.map((line) => ({
      doc_header_id: docHeaderId,
      product_id: line.row.matchedProduct!.id,
      description: line.row.raw_description ?? line.row.matchedProduct!.name,
      qty: line.qty,
      uom_used: "ตัว",
      unit_price: line.unitPrice,
      unit_cost_price: line.unitCostPrice,
      discount_text: line.row.discount_text ?? "",
      discount_amount: line.discountAmount,
      line_total: line.lineTotal,
    }));

    const { error: docDetailsError } = await supabaseAdmin
      .from("doc_details")
      .insert(docDetailsPayload);

    if (docDetailsError) {
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        docHeaderId: null,
        docNo: null,
        error: docDetailsError.message ?? "บันทึกรายการสินค้า (doc_details) ไม่สำเร็จ",
      };
    }

    // 2b. Phase 4 `documents` + `document_items` (Purchase Document List bridge)
    const runningPrefix =
      DOCUMENT_TYPE_PREFIX[resolvedDocType as DocumentType] ?? "APT";
    const { data: phase4DocNoRaw, error: phase4NoError } = await supabaseAdmin.rpc(
      "generate_document_no",
      { p_doc_type: runningPrefix, p_doc_date: docDate },
    );

    if (phase4NoError || typeof phase4DocNoRaw !== "string" || !phase4DocNoRaw) {
      await supabaseAdmin.from("doc_details").delete().eq("doc_header_id", docHeaderId);
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        docHeaderId: null,
        docNo: null,
        error:
          phase4NoError?.message ??
          "สร้างเลขที่เอกสาร Phase 4 (documents) ไม่สำเร็จ",
      };
    }

    const phase4DocNo = phase4DocNoRaw;
    const nowIso = new Date().toISOString();
    const vendorInvoiceNote = `อ้างอิงบิลซัพพลายเออร์: ${docNo}`;
    const resolvedAttachmentUrl = attachmentUrl?.trim() || null;

    const { data: phase4Document, error: phase4DocError } = await supabaseAdmin
      .from("documents")
      .insert({
        doc_no: phase4DocNo,
        doc_type: resolvedDocType,
        status: resolveIssuedDocumentStatus(resolvedDocType),
        doc_date: docDate,
        contact_id: vendorId,
        contact_person_id: null,
        sub_total: subTotal,
        discount_amount: discountAmount,
        tax_rate: vatSummary.vat_rate,
        tax_amount: vatSummary.vat_amount,
        grand_total: grandTotal,
        vat_type: resolvedVatType,
        vat_rate: vatSummary.vat_rate,
        total_amount: vatSummary.total_amount,
        net_before_vat: vatSummary.net_before_vat,
        vat_amount: vatSummary.vat_amount,
        discount_text: billDiscountText?.trim() || null,
        payment_status: resolveInitialPaymentStatus(resolvedDocType),
        paid_amount:
          resolveInitialPaymentStatus(resolvedDocType) === "PAID"
            ? grandTotal
            : 0,
        notes: vendorInvoiceNote,
        attachment_url: resolvedAttachmentUrl,
        attached_file_url: resolvedAttachmentUrl,
        original_file_name: resolvedAttachmentUrl
          ? resolvedAttachmentUrl.split("/").pop() || null
          : null,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (phase4DocError || !phase4Document) {
      await supabaseAdmin.from("doc_details").delete().eq("doc_header_id", docHeaderId);
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        docHeaderId: null,
        docNo: null,
        error:
          phase4DocError?.message ??
          "สร้างเอกสารรับสินค้า (documents / Phase 4) ไม่สำเร็จ",
      };
    }

    const phase4DocumentId = phase4Document.id as string;

    const phase4ItemsPayload = lines.map((line, index) => ({
      document_id: phase4DocumentId,
      product_id: line.row.matchedProduct!.id,
      description: (
        line.row.raw_description ??
        line.row.matchedProduct!.name ??
        ""
      ).slice(0, 255),
      qty: line.qty,
      uom_used: "ตัว",
      unit_price: line.unitPrice,
      unit_cost_price: line.unitCostPrice,
      discount_text: line.row.discount_text?.trim() || null,
      discount_amount: line.discountAmount,
      line_total: line.lineTotal,
      sort_order: index,
    }));

    const { error: phase4ItemsError } = await supabaseAdmin
      .from("document_items")
      .insert(phase4ItemsPayload);

    if (phase4ItemsError) {
      await supabaseAdmin.from("documents").delete().eq("id", phase4DocumentId);
      await supabaseAdmin.from("doc_details").delete().eq("doc_header_id", docHeaderId);
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        docHeaderId: null,
        docNo: null,
        error:
          phase4ItemsError.message ??
          "บันทึกรายการสินค้า (document_items) ไม่สำเร็จ",
      };
    }

    // 3. inventory_ledger — the ONLY table allowed to move stock ("IN")
    const ledgerPayload = lines.map((line) => ({
      product_id: line.row.matchedProduct!.id,
      doc_header_id: docHeaderId,
      trans_type: "IN",
      qty: line.qty,
      notes: `รับสินค้าจากเอกสาร ${docNo} (${phase4DocNo}) — Vendor SKU: ${line.row.raw_vendor_sku}`,
    }));

    const { error: ledgerError } = await supabaseAdmin
      .from("inventory_ledger")
      .insert(ledgerPayload);

    if (ledgerError) {
      // Compensating rollback — never leave a financial doc without its stock movement.
      await supabaseAdmin.from("documents").delete().eq("id", phase4DocumentId);
      await supabaseAdmin.from("doc_details").delete().eq("doc_header_id", docHeaderId);
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        docHeaderId: null,
        docNo: null,
        error: ledgerError.message ?? "บันทึกการรับเข้าคลัง (inventory_ledger) ไม่สำเร็จ",
      };
    }

    // 4. Last Purchase Price (LPP) — push finalUnitCost into products.cost_price.
    // Skips FOC lines so free goods never wipe a real historical cost.
    // Uses service-role admin client (Zero Client-Side Fetching).
    const lppTargets = lines.filter(
      (line) => !line.row.isFoc && line.row.matchedProduct?.id,
    );

    if (lppTargets.length > 0) {
      // Collapse duplicates (same internal product on multiple receipt rows)
      // so the latest finalUnitCost for that product wins.
      const costByProductId = new Map<string, number>();
      for (const line of lppTargets) {
        costByProductId.set(line.row.matchedProduct!.id, line.unitCostPrice);
      }

      const lppResults = await Promise.all(
        [...costByProductId.entries()].map(([productId, costPrice]) =>
          supabaseAdmin
            .from("products")
            .update({ cost_price: costPrice })
            .eq("id", productId),
        ),
      );

      const lppError = lppResults.find((result) => result.error)?.error;
      if (lppError) {
        // Compensating rollback — keep receipt + LPP atomic.
        await supabaseAdmin
          .from("inventory_ledger")
          .delete()
          .eq("doc_header_id", docHeaderId);
        await supabaseAdmin.from("documents").delete().eq("id", phase4DocumentId);
        await supabaseAdmin
          .from("doc_details")
          .delete()
          .eq("doc_header_id", docHeaderId);
        await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
        return {
          docHeaderId: null,
          docNo: null,
          error:
            lppError.message ??
            "อัปเดตราคาต้นทุนล่าสุด (products.cost_price) ไม่สำเร็จ",
        };
      }
    }

    // Return Phase 4 doc_no so Purchase List / deep-links stay consistent.
    return { docHeaderId, docNo: phase4DocNo, error: null };
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
  lines: ManualGoodsReceiptLineInput[];
};

export type SaveManualGoodsReceiptResult = {
  data: {
    document_id: string;
    doc_no: string;
    ledger_count: number;
  } | null;
  error: string | null;
};

/**
 * Manual Goods Receipt (no OCR): create Phase 4 `documents` + items,
 * post `inventory_ledger` IN, and push LPP to `products.cost_price`.
 *
 * Net unit cost always goes through Apportionment Math Engine
 * (INCLUSIVE strips VAT before discount; bill discount is prorated).
 * Service Role only — Zero Client-Side Fetching.
 */
export async function saveManualGoodsReceipt(
  input: SaveManualGoodsReceiptInput,
): Promise<SaveManualGoodsReceiptResult> {
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
    const vatRate = resolvedVatType === "NONE" ? 0 : 7;
    const discountText = input?.discountText?.trim() || null;

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
      if (!Number.isFinite(line.qty) || line.qty <= 0) {
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

    const supabaseAdmin = createSupabaseAdminClient();

    const { data: vendor, error: vendorError } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("id", vendorId)
      .eq("contact_type", "Vendor")
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
      .select("id, name, sku, base_uom, is_active")
      .in("id", productIds);

    if (productsError) {
      return { data: null, error: productsError.message };
    }

    const productById = new Map(
      (products ?? []).map((row) => [row.id as string, row]),
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
      const qty = Math.round(Number(line.qty));
      const unitPrice = Number(line.unit_cost) || 0;
      const lineKey = `line-${index}-${productId}`;
      return {
        lineKey,
        product_id: productId,
        description: (
          line.description?.trim() ||
          String(product.name ?? "") ||
          ""
        ).slice(0, 255),
        sku: line.sku?.trim() || String(product.sku ?? ""),
        qty,
        uom_used: String(product.base_uom ?? "ตัว"),
        unitPrice,
        sort_order: index,
      };
    });

    const apportionmentItems: ApportionmentItem[] = preparedLines.map((line) => ({
      id: line.lineKey,
      unitPrice: line.unitPrice,
      qty: line.qty,
      discountText: null,
      isFoc: false,
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
      const unitCostPrice = roundMoney(cost?.finalUnitCost ?? 0);
      const discountAmount = roundMoney(line.unitPrice * line.qty - invoiceLineTotal);
      return {
        product_id: line.product_id,
        description: line.description,
        sku: line.sku,
        qty: line.qty,
        uom_used: line.uom_used,
        unit_price: roundMoney(line.unitPrice),
        unit_cost: unitCostPrice,
        discount_amount: discountAmount,
        line_total: invoiceLineTotal,
        sort_order: line.sort_order,
      };
    });

    const subTotal = roundMoney(
      normalizedLines.reduce((sum, line) => sum + line.unit_price * line.qty, 0),
    );
    const discountAmount = roundMoney(
      normalizedLines.reduce((sum, line) => sum + line.discount_amount, 0),
    );
    const vatSummary = calculateDocumentSummary({
      lineTotals: normalizedLines.map((line) => line.line_total),
      discountText: null,
      vatType: resolvedVatType,
      vatRate,
    });
    const grandTotal = roundMoney(vatSummary.grand_total);

    const runningPrefix =
      DOCUMENT_TYPE_PREFIX[resolvedDocType as DocumentType] ?? "APT";
    const { data: phase4DocNoRaw, error: phase4NoError } = await supabaseAdmin.rpc(
      "generate_document_no",
      { p_doc_type: runningPrefix, p_doc_date: docDate },
    );

    if (phase4NoError || typeof phase4DocNoRaw !== "string" || !phase4DocNoRaw) {
      return {
        data: null,
        error:
          phase4NoError?.message ?? "สร้างเลขที่เอกสารรับสินค้าไม่สำเร็จ",
      };
    }

    const phase4DocNo = phase4DocNoRaw;
    const nowIso = new Date().toISOString();
    const notes = `รับสินค้าแบบ Manual · อ้างอิงบิลซัพพลายเออร์: ${documentRef}`;

    const { data: docHeader, error: docHeaderError } = await supabaseAdmin
      .from("doc_headers")
      .insert({
        doc_no: documentRef,
        doc_type: resolvedDocType,
        doc_date: docDate,
        contact_id: vendorId,
        sub_total: subTotal,
        discount_amount: discountAmount,
        grand_total: grandTotal,
        payment_status: resolveInitialPaymentStatus(resolvedDocType),
      })
      .select("id")
      .single();

    if (docHeaderError || !docHeader) {
      const isDuplicate = docHeaderError?.code === "23505";
      return {
        data: null,
        error: isDuplicate
          ? `เลขที่อ้างอิง "${documentRef}" ลงวันที่ ${docDate} ถูกบันทึกแล้วสำหรับผู้จำหน่ายรายนี้`
          : (docHeaderError?.message ?? "สร้างเอกสารอ้างอิง (doc_headers) ไม่สำเร็จ"),
      };
    }

    const docHeaderId = docHeader.id as string;

    const { error: detailsError } = await supabaseAdmin.from("doc_details").insert(
      normalizedLines.map((line) => ({
        doc_header_id: docHeaderId,
        product_id: line.product_id,
        description: line.description,
        qty: line.qty,
        uom_used: line.uom_used,
        unit_price: line.unit_price,
        unit_cost_price: line.unit_cost,
        discount_text: "",
        discount_amount: line.discount_amount,
        line_total: line.line_total,
      })),
    );

    if (detailsError) {
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        data: null,
        error: detailsError.message ?? "บันทึกรายการ (doc_details) ไม่สำเร็จ",
      };
    }

    const { data: document, error: documentError } = await supabaseAdmin
      .from("documents")
      .insert({
        doc_no: phase4DocNo,
        doc_type: resolvedDocType,
        status: resolveIssuedDocumentStatus(resolvedDocType),
        doc_date: docDate,
        contact_id: vendorId,
        contact_person_id: null,
        sub_total: subTotal,
        discount_amount: discountAmount,
        tax_rate: vatSummary.vat_rate,
        tax_amount: vatSummary.vat_amount,
        grand_total: grandTotal,
        vat_type: resolvedVatType,
        vat_rate: vatSummary.vat_rate,
        total_amount: vatSummary.total_amount,
        net_before_vat: vatSummary.net_before_vat,
        vat_amount: vatSummary.vat_amount,
        discount_text: discountText,
        payment_status: resolveInitialPaymentStatus(resolvedDocType),
        paid_amount:
          resolveInitialPaymentStatus(resolvedDocType) === "PAID"
            ? grandTotal
            : 0,
        notes,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (documentError || !document) {
      await supabaseAdmin.from("doc_details").delete().eq("doc_header_id", docHeaderId);
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        data: null,
        error: documentError?.message ?? "สร้างเอกสารรับสินค้า (documents) ไม่สำเร็จ",
      };
    }

    const documentId = document.id as string;

    const { error: itemsError } = await supabaseAdmin.from("document_items").insert(
      normalizedLines.map((line) => ({
        document_id: documentId,
        product_id: line.product_id,
        description: line.description,
        qty: line.qty,
        uom_used: line.uom_used,
        unit_price: line.unit_price,
        unit_cost_price: line.unit_cost,
        discount_text: null,
        discount_amount: line.discount_amount,
        line_total: line.line_total,
        sort_order: line.sort_order,
      })),
    );

    if (itemsError) {
      await supabaseAdmin.from("documents").delete().eq("id", documentId);
      await supabaseAdmin.from("doc_details").delete().eq("doc_header_id", docHeaderId);
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        data: null,
        error: itemsError.message ?? "บันทึกรายการสินค้าในเอกสารไม่สำเร็จ",
      };
    }

    const ledgerPayload = normalizedLines.map((line) => ({
      product_id: line.product_id,
      doc_header_id: docHeaderId,
      trans_type: "IN",
      qty: line.qty,
      notes: `รับสินค้า Manual จากเอกสาร ${phase4DocNo} (อ้างอิง ${documentRef}) | document_id=${documentId} | net_cost=${line.unit_cost} | SKU: ${line.sku || "-"}`,
    }));

    const { error: ledgerError } = await supabaseAdmin
      .from("inventory_ledger")
      .insert(ledgerPayload);

    if (ledgerError) {
      await supabaseAdmin.from("documents").delete().eq("id", documentId);
      await supabaseAdmin.from("doc_details").delete().eq("doc_header_id", docHeaderId);
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        data: null,
        error:
          ledgerError.message ?? "บันทึกการรับเข้าคลัง (inventory_ledger) ไม่สำเร็จ",
      };
    }

    const costByProductId = new Map<string, number>();
    for (const line of normalizedLines) {
      costByProductId.set(line.product_id, line.unit_cost);
    }

    const lppResults = await Promise.all(
      [...costByProductId.entries()].map(([productId, costPrice]) =>
        supabaseAdmin
          .from("products")
          .update({ cost_price: costPrice })
          .eq("id", productId),
      ),
    );

    const lppError = lppResults.find((result) => result.error)?.error;
    if (lppError) {
      await supabaseAdmin
        .from("inventory_ledger")
        .delete()
        .eq("doc_header_id", docHeaderId);
      await supabaseAdmin.from("documents").delete().eq("id", documentId);
      await supabaseAdmin.from("doc_details").delete().eq("doc_header_id", docHeaderId);
      await supabaseAdmin.from("doc_headers").delete().eq("id", docHeaderId);
      return {
        data: null,
        error:
          lppError.message ??
          "อัปเดตราคาต้นทุนล่าสุด (products.cost_price) ไม่สำเร็จ",
      };
    }

    return {
      data: {
        document_id: documentId,
        doc_no: (document.doc_no as string) || phase4DocNo,
        ledger_count: ledgerPayload.length,
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
