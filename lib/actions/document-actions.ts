"use server";

/**
 * Phase 4 — Document Engine Server Actions.
 *
 * Next.js rule: a `"use server"` file may ONLY export async functions.
 * Types / constants live in `types/document.ts` and `lib/constants/document.ts`.
 *
 * Zero Client-Side Fetching: Service Role admin client only.
 */

import {
  CONVERT_TARGET_DOC_TYPES,
  DOCUMENT_TYPE_PREFIX,
  DOCUMENT_TYPES,
  PURCHASE_DOC_TYPES,
  SALES_DOC_TYPES,
  STOCK_OUT_DOC_TYPES,
  resolveInitialPaymentStatus,
  resolveIssuedDocumentStatus,
} from "@/lib/constants/document";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import {
  calculateDocumentSummary,
  isVatCalculationType,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import type {
  CompleteDocumentInput,
  CompleteDocumentResult,
  ContactPersonOption,
  ConvertDocumentResult,
  ConvertTargetDocType,
  CreateDocumentInput,
  CreateDocumentResult,
  CreateDraftDocumentInput,
  CreateDraftDocumentResult,
  CustomerOption,
  DocumentDetail,
  DocumentDetailItem,
  DocumentListFilters,
  DocumentRow,
  DocumentStatus,
  DocumentType,
  GenerateDocumentNumberResult,
  GetContactPersonsResult,
  GetCustomersResult,
  GetDocumentByNoResult,
  GetPurchaseDocumentsResult,
  GetSalesDocumentsResult,
  IssueDocumentResult,
  PurchaseDocumentListItem,
  SalesDocumentListItem,
  SalesProductSearchItem,
  SearchProductsForSalesResult,
  UploadDocumentImageResult,
} from "@/types/document";

const DOCUMENT_ATTACHMENTS_BUCKET = "document_attachments";
const ALLOWED_ATTACHMENT_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

function isDocumentType(value: string): value is DocumentType {
  return (DOCUMENT_TYPES as readonly string[]).includes(value);
}

function isStockOutDocType(value: DocumentType): boolean {
  return (STOCK_OUT_DOC_TYPES as readonly string[]).includes(value);
}

function isConvertTargetDocType(value: string): value is ConvertTargetDocType {
  return (CONVERT_TARGET_DOC_TYPES as readonly string[]).includes(value);
}

type ProductCostRow = {
  id: string;
  sku: string;
  name: string;
  cost_price: number | string | null;
  base_uom: string | null;
};

/**
 * Auto-running document number via Postgres RPC `generate_document_no`
 * (EXCLUSIVE lock — race-safe): `{PREFIX}-{YYMM}-{XXXX}`
 * Example: TAX_INV → `INV-2607-0001`
 */
export async function generateDocumentNumber(
  docType: DocumentType,
  docDate?: string | null,
): Promise<GenerateDocumentNumberResult> {
  try {
    if (!isDocumentType(docType)) {
      return { data: null, error: `ประเภทเอกสารไม่ถูกต้อง: ${docType}` };
    }

    const prefix = DOCUMENT_TYPE_PREFIX[docType];
    const dateIso =
      typeof docDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(docDate.trim())
        ? docDate.trim()
        : new Date().toISOString().slice(0, 10);

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase.rpc("generate_document_no", {
      p_doc_type: prefix,
      p_doc_date: dateIso,
    });

    if (error) {
      return { data: null, error: error.message };
    }

    const docNo = typeof data === "string" ? data : null;
    if (!docNo) {
      return {
        data: null,
        error: "RPC generate_document_no ไม่คืนเลขที่เอกสาร",
      };
    }

    return { data: docNo, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "สร้างเลขที่เอกสารไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/**
 * Create a DRAFT document header + optional line items.
 * Running number comes from `generate_document_no` RPC (Service Role only).
 * Returns `{ document_id, document_no }` for the sales UI.
 */
export async function createDraftDocument(
  payload: CreateDraftDocumentInput,
): Promise<CreateDraftDocumentResult> {
  try {
    const docType = payload?.doc_type?.trim() as DocumentType;
    const contactId = payload?.contact_id?.trim() ?? "";
    const contactPersonId = payload?.contact_person_id?.trim() || null;
    const items = Array.isArray(payload?.items) ? payload.items : [];
    const docDate =
      typeof payload?.doc_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(payload.doc_date.trim())
        ? payload.doc_date.trim()
        : new Date().toISOString().slice(0, 10);

    if (!isDocumentType(docType)) {
      return { data: null, error: "กรุณาเลือกประเภทเอกสารให้ถูกต้อง" };
    }
    if (!contactId) {
      return { data: null, error: "กรุณาเลือกลูกค้า / คู่ค้า" };
    }

    for (const [index, item] of items.entries()) {
      if (!item.product_id?.trim()) {
        return { data: null, error: `รายการที่ ${index + 1}: ไม่มี product_id` };
      }
      if (!Number.isFinite(item.qty) || item.qty <= 0) {
        return {
          data: null,
          error: `รายการที่ ${index + 1}: จำนวนต้องมากกว่า 0`,
        };
      }
      if (!Number.isFinite(item.unit_price) || item.unit_price < 0) {
        return {
          data: null,
          error: `รายการที่ ${index + 1}: ราคาต่อหน่วยไม่ถูกต้อง`,
        };
      }
    }

    const numberResult = await generateDocumentNumber(docType, docDate);
    if (numberResult.error || !numberResult.data) {
      return {
        data: null,
        error: numberResult.error ?? "สร้างเลขที่เอกสารไม่สำเร็จ",
      };
    }

    const documentNo = numberResult.data;
    const supabase = createSupabaseServerClient();

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("is_active", true)
      .maybeSingle();

    if (contactError) {
      return { data: null, error: contactError.message };
    }
    if (!contact) {
      return { data: null, error: "ไม่พบคู่ค้าที่เลือก หรือถูกปิดใช้งาน" };
    }

    if (contactPersonId) {
      const { data: person, error: personError } = await supabase
        .from("contact_persons")
        .select("id, contact_id")
        .eq("id", contactPersonId)
        .eq("contact_id", contactId)
        .maybeSingle();

      if (personError) {
        return { data: null, error: personError.message };
      }
      if (!person) {
        return {
          data: null,
          error: "ผู้ติดต่อที่เลือกไม่ตรงกับลูกค้ารายนี้",
        };
      }
    }

    const productIds = [
      ...new Set(items.map((item) => item.product_id.trim()).filter(Boolean)),
    ];
    const costByProductId = new Map<string, number>();
    const nameByProductId = new Map<string, string>();
    const uomByProductId = new Map<string, string>();

    if (productIds.length > 0) {
      const { data: products, error: productsError } = await supabase
        .from("products")
        .select("id, name, cost_price, base_uom")
        .in("id", productIds)
        .eq("is_active", true);

      if (productsError) {
        return { data: null, error: productsError.message };
      }

      for (const row of products ?? []) {
        const id = row.id as string;
        const cost = Number(row.cost_price ?? 0);
        costByProductId.set(id, Number.isFinite(cost) ? cost : 0);
        nameByProductId.set(id, String(row.name ?? ""));
        if (row.base_uom) uomByProductId.set(id, String(row.base_uom));
      }

      for (const productId of productIds) {
        if (!costByProductId.has(productId)) {
          return {
            data: null,
            error: `ไม่พบสินค้าในระบบ หรือถูกปิดใช้งาน: ${productId}`,
          };
        }
      }
    }

    const lineRows = items.map((item, index) => {
      const productId = item.product_id.trim();
      const snapshotCost = costByProductId.has(productId)
        ? costByProductId.get(productId)!
        : Number(item.unit_cost_price ?? 0);
      const discountAmount = Number(item.discount_amount ?? 0);
      const lineTotal = Number(item.line_total);

      return {
        product_id: productId,
        description: (
          item.description?.trim() ||
          nameByProductId.get(productId) ||
          ""
        ).slice(0, 255),
        qty: item.qty,
        uom_used:
          item.uom_used?.trim() || uomByProductId.get(productId) || "ตัว",
        unit_price: item.unit_price,
        unit_cost_price: Number.isFinite(snapshotCost) ? snapshotCost : 0,
        discount_text: item.discount_text?.trim() || null,
        discount_amount: Number.isFinite(discountAmount) ? discountAmount : 0,
        line_total: Number.isFinite(lineTotal) ? lineTotal : 0,
        sort_order: item.sort_order ?? index,
      };
    });

    const vatType: VatCalculationType = isVatCalculationType(
      String(payload.vat_type ?? "EXCLUSIVE"),
    )
      ? (payload.vat_type as VatCalculationType)
      : "EXCLUSIVE";
    const vatRate = Number(payload.vat_rate ?? 7);
    const discountText = payload.discount_text?.trim() || null;

    // Always recompute server-side — never trust client money totals alone.
    const summary = calculateDocumentSummary({
      lineTotals: lineRows.map((row) => Number(row.line_total)),
      discountText,
      vatType,
      vatRate: Number.isFinite(vatRate) ? vatRate : 7,
    });

    const nowIso = new Date().toISOString();
    const draftStatus: DocumentStatus = "DRAFT";

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .insert({
        doc_no: documentNo,
        doc_type: docType,
        status: draftStatus,
        doc_date: docDate,
        contact_id: contactId,
        contact_person_id: contactPersonId,
        // Legacy money columns (kept in sync)
        sub_total: summary.total_amount,
        discount_amount: summary.discount_amount,
        tax_rate: summary.vat_rate,
        tax_amount: summary.vat_amount,
        grand_total: summary.grand_total,
        // Phase 4 VAT / summary columns
        vat_type: summary.vat_type,
        vat_rate: summary.vat_rate,
        total_amount: summary.total_amount,
        net_before_vat: summary.net_before_vat,
        vat_amount: summary.vat_amount,
        discount_text: discountText,
        payment_status: resolveInitialPaymentStatus(docType),
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (documentError || !document) {
      return {
        data: null,
        error: documentError?.message ?? "บันทึกเอกสารร่างไม่สำเร็จ",
      };
    }

    const documentId = document.id as string;

    if (lineRows.length > 0) {
      const itemsPayload = lineRows.map((row) => ({
        ...row,
        document_id: documentId,
      }));

      const { error: itemsError } = await supabase
        .from("document_items")
        .insert(itemsPayload);

      if (itemsError) {
        await supabase.from("documents").delete().eq("id", documentId);
        return {
          data: null,
          error:
            itemsError.message ?? "บันทึกรายการสินค้าในเอกสารร่างไม่สำเร็จ",
        };
      }
    }

    return {
      data: {
        document_id: documentId,
        document_no: (document.doc_no as string) || documentNo,
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "สร้างเอกสารร่างไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/**
 * Create a DRAFT document header for the given type + customer/vendor contact.
 * Running number is generated server-side — never trust client-supplied doc_no.
 */
export async function createDocument(
  input: CreateDocumentInput,
): Promise<CreateDocumentResult> {
  try {
    const docType = input.doc_type?.trim() as DocumentType;
    const contactId = input.contact_id?.trim() ?? "";
    const contactPersonId = input.contact_person_id?.trim() || null;

    if (!isDocumentType(docType)) {
      return { data: null, error: "กรุณาเลือกประเภทเอกสารให้ถูกต้อง" };
    }
    if (!contactId) {
      return { data: null, error: "กรุณาเลือกลูกค้า / คู่ค้า" };
    }

    const numberResult = await generateDocumentNumber(docType);
    if (numberResult.error || !numberResult.data) {
      return {
        data: null,
        error: numberResult.error ?? "สร้างเลขที่เอกสารไม่สำเร็จ",
      };
    }

    const supabase = createSupabaseServerClient();

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .eq("is_active", true)
      .maybeSingle();

    if (contactError) {
      return { data: null, error: contactError.message };
    }
    if (!contact) {
      return { data: null, error: "ไม่พบคู่ค้าที่เลือก หรือถูกปิดใช้งาน" };
    }

    if (contactPersonId) {
      const { data: person, error: personError } = await supabase
        .from("contact_persons")
        .select("id, contact_id")
        .eq("id", contactPersonId)
        .eq("contact_id", contactId)
        .maybeSingle();

      if (personError) {
        return { data: null, error: personError.message };
      }
      if (!person) {
        return {
          data: null,
          error: "ผู้ติดต่อที่เลือกไม่ตรงกับลูกค้ารายนี้",
        };
      }
    }

    const nowIso = new Date().toISOString();
    const draftStatus: DocumentStatus = "DRAFT";
    const insertPayload = {
      doc_no: numberResult.data,
      doc_type: docType,
      status: draftStatus,
      doc_date: nowIso.slice(0, 10),
      contact_id: contactId,
      contact_person_id: contactPersonId,
      payment_status: resolveInitialPaymentStatus(docType),
      updated_at: nowIso,
    };
    const selectColumns =
      "id, created_at, updated_at, doc_no, doc_type, status, doc_date, due_date, contact_id, contact_person_id, ref_doc_id, sub_total, discount_amount, tax_rate, tax_amount, wht_rate, wht_amount, grand_total, deposit_deducted, payment_status, notes, attached_file_url, original_file_name";

    const { data, error } = await supabase
      .from("documents")
      .insert(insertPayload)
      .select(selectColumns)
      .single();

    if (error || !data) {
      if (error?.code === "23505") {
        const retryNumber = await generateDocumentNumber(docType);
        if (retryNumber.error || !retryNumber.data) {
          return {
            data: null,
            error: retryNumber.error ?? "สร้างเลขที่เอกสารไม่สำเร็จ (retry)",
          };
        }

        const retry = await supabase
          .from("documents")
          .insert({
            ...insertPayload,
            doc_no: retryNumber.data,
          })
          .select(selectColumns)
          .single();

        if (retry.error || !retry.data) {
          return {
            data: null,
            error: retry.error?.message ?? "บันทึกเอกสารไม่สำเร็จหลัง retry",
          };
        }
        return { data: retry.data as DocumentRow, error: null };
      }

      return {
        data: null,
        error: error?.message ?? "บันทึกเอกสารไม่สำเร็จ",
      };
    }

    return { data: data as DocumentRow, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "สร้างเอกสารไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/** Active customers for the sales document header combobox. */
export async function listActiveCustomers(): Promise<GetCustomersResult> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("contacts")
      .select("id, company_name")
      .eq("contact_type", "Customer")
      .eq("is_active", true)
      .order("company_name");

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as CustomerOption[], error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายการลูกค้าไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * Contact persons for a selected customer — Service Role only.
 * Used by the sales header "ผู้ติดต่อ" Smart Combobox.
 */
export async function getContactPersons(
  contactId: string,
): Promise<GetContactPersonsResult> {
  try {
    const trimmed = contactId?.trim() ?? "";
    if (!trimmed) {
      return { data: [], error: null };
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("contact_persons")
      .select(
        "id, contact_id, name, phone, email, department_or_role, is_primary",
      )
      .eq("contact_id", trimmed)
      .order("is_primary", { ascending: false })
      .order("name", { ascending: true });

    if (error) return { data: [], error: error.message };
    return { data: (data ?? []) as ContactPersonOption[], error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายชื่อผู้ติดต่อไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* searchProductsForSales                                                     */
/* -------------------------------------------------------------------------- */

function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function toMoneyNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

type ProductSearchRow = {
  id: string;
  sku: string;
  name: string | null;
  retail_price: number | string | null;
  cost_price: number | string | null;
  base_uom: string | null;
  color: string | null;
  size: string | null;
  product_models:
    | { id: string; name: string | null; model_code: string | null }
    | { id: string; name: string | null; model_code: string | null }[]
    | null;
};

/**
 * Search active products for the sales SKU picker.
 * Joins `product_models` (+ enriches color/size via `mst_colors` / `mst_sizes`)
 * and returns `unit_price` (from retail_price) + `cost_price` for Cost Snapshot.
 *
 * Match: `products.sku` OR `product_models.name` (ilike), limit 10.
 */
export async function searchProductsForSales(
  keyword: string,
): Promise<SearchProductsForSalesResult> {
  try {
    const trimmed = keyword?.trim() ?? "";
    if (trimmed.length < 1) {
      return { data: [], error: null };
    }

    const pattern = `%${escapeIlikePattern(trimmed)}%`;
    const supabase = createSupabaseServerClient();

    const productSelect = `
      id,
      sku,
      name,
      retail_price,
      cost_price,
      base_uom,
      color,
      size,
      product_models (
        id,
        name,
        model_code
      )
    `;

    const [{ data: matchedModels, error: modelError }, skuResult, nameResult] =
      await Promise.all([
        supabase.from("product_models").select("id").ilike("name", pattern).limit(30),
        supabase
          .from("products")
          .select(productSelect)
          .eq("is_active", true)
          .ilike("sku", pattern)
          .order("sku", { ascending: true })
          .limit(10),
        supabase
          .from("products")
          .select(productSelect)
          .eq("is_active", true)
          .ilike("name", pattern)
          .order("sku", { ascending: true })
          .limit(10),
      ]);

    if (modelError) return { data: [], error: modelError.message };
    if (skuResult.error) return { data: [], error: skuResult.error.message };
    if (nameResult.error) return { data: [], error: nameResult.error.message };

    const modelIds = (matchedModels ?? [])
      .map((row) => row.id as string)
      .filter(Boolean);

    let modelProducts: ProductSearchRow[] = [];
    if (modelIds.length > 0) {
      const byModel = await supabase
        .from("products")
        .select(productSelect)
        .eq("is_active", true)
        .in("model_id", modelIds)
        .order("sku", { ascending: true })
        .limit(10);

      if (byModel.error) {
        return { data: [], error: byModel.error.message };
      }
      modelProducts = (byModel.data ?? []) as ProductSearchRow[];
    }

    const byId = new Map<string, ProductSearchRow>();
    for (const row of [
      ...((skuResult.data ?? []) as ProductSearchRow[]),
      ...((nameResult.data ?? []) as ProductSearchRow[]),
      ...modelProducts,
    ]) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }

    const rows = [...byId.values()].slice(0, 10);
    if (rows.length === 0) {
      return { data: [], error: null };
    }

    const colorCodes = [
      ...new Set(
        rows
          .map((row) => row.color?.trim().toUpperCase() ?? "")
          .filter(Boolean),
      ),
    ];
    const sizeLabels = [
      ...new Set(rows.map((row) => row.size?.trim() ?? "").filter(Boolean)),
    ];

    const [colorsResult, sizesResult] = await Promise.all([
      colorCodes.length > 0
        ? supabase
            .from("mst_colors")
            .select("color_code, color_name")
            .in("color_code", colorCodes)
        : Promise.resolve({
            data: [] as { color_code: string; color_name: string }[],
            error: null,
          }),
      sizeLabels.length > 0
        ? supabase
            .from("mst_sizes")
            .select("size_label, size_code")
            .in("size_label", sizeLabels)
        : Promise.resolve({
            data: [] as { size_label: string; size_code: string }[],
            error: null,
          }),
    ]);

    if (colorsResult.error) {
      return { data: [], error: colorsResult.error.message };
    }
    if (sizesResult.error) {
      return { data: [], error: sizesResult.error.message };
    }

    const colorNameByCode = new Map(
      (colorsResult.data ?? []).map((row) => [
        String(row.color_code).trim().toUpperCase(),
        String(row.color_name),
      ]),
    );
    const sizeMetaByLabel = new Map(
      (sizesResult.data ?? []).map((row) => [
        String(row.size_label).trim().toUpperCase(),
        {
          label: String(row.size_label),
          code: String(row.size_code),
        },
      ]),
    );

    const items: SalesProductSearchItem[] = rows.map((row) => {
      const model = unwrapJoin(row.product_models);
      const modelName = model?.name?.trim() || null;
      const colorCode = row.color?.trim().toUpperCase() ?? "";
      const sizeKey = row.size?.trim().toUpperCase() ?? "";
      const colorName =
        colorNameByCode.get(colorCode) ?? (row.color?.trim() || null);
      const sizeMeta = sizeMetaByLabel.get(sizeKey);
      const sizeLabel = sizeMeta?.label ?? (row.size?.trim() || null);

      const parts = [
        modelName || row.name?.trim() || row.sku,
        colorName,
        sizeLabel,
      ].filter(Boolean);

      return {
        id: row.id,
        sku: row.sku,
        unit_price: toMoneyNumber(row.retail_price),
        cost_price: toMoneyNumber(row.cost_price),
        display_name: parts.join(" · "),
        model_name: modelName,
        color_name: colorName,
        size_label: sizeLabel,
        base_uom: row.base_uom,
      };
    });

    return { data: items, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ค้นหาสินค้าไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * Finalize a DRAFT sales document:
 * 1. Snapshot `products.cost_price` → `document_items.unit_cost_price`
 * 2. INSERT all lines into `document_items`
 * 3. Roll up header totals + set status `ISSUED`
 * 4. For stock-moving doc types: INSERT `inventory_ledger` (`trans_type = OUT`)
 */
export async function completeDocument(
  input: CompleteDocumentInput,
): Promise<CompleteDocumentResult> {
  try {
    const documentId = input.document_id?.trim() ?? "";
    const items = Array.isArray(input.items) ? input.items : [];

    if (!documentId) {
      return { data: null, error: "ไม่พบรหัสเอกสาร (document_id)" };
    }
    if (items.length === 0) {
      return { data: null, error: "กรุณาเพิ่มรายการสินค้าอย่างน้อย 1 รายการ" };
    }

    for (const [index, item] of items.entries()) {
      if (!item.product_id?.trim()) {
        return { data: null, error: `รายการที่ ${index + 1}: ไม่มี product_id` };
      }
      if (!Number.isFinite(item.qty) || item.qty <= 0) {
        return {
          data: null,
          error: `รายการที่ ${index + 1}: จำนวนต้องมากกว่า 0`,
        };
      }
      if (!Number.isFinite(item.unit_price) || item.unit_price < 0) {
        return {
          data: null,
          error: `รายการที่ ${index + 1}: ราคาต่อหน่วยไม่ถูกต้อง`,
        };
      }
    }

    const supabase = createSupabaseServerClient();

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, status, tax_rate")
      .eq("id", documentId)
      .maybeSingle();

    if (documentError) {
      return { data: null, error: documentError.message };
    }
    if (!document) {
      return { data: null, error: "ไม่พบเอกสารที่ระบุ" };
    }
    if (document.status !== "DRAFT") {
      return {
        data: null,
        error: `เอกสาร ${document.doc_no} ไม่ใช่สถานะ DRAFT (ปัจจุบัน: ${document.status})`,
      };
    }

    const productIds = [...new Set(items.map((item) => item.product_id.trim()))];
    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, sku, name, cost_price, base_uom")
      .in("id", productIds)
      .eq("is_active", true);

    if (productsError) {
      return { data: null, error: productsError.message };
    }

    const productById = new Map(
      ((products ?? []) as ProductCostRow[]).map((row) => [row.id, row]),
    );

    for (const productId of productIds) {
      if (!productById.has(productId)) {
        return {
          data: null,
          error: `ไม่พบสินค้าในระบบ หรือถูกปิดใช้งาน: ${productId}`,
        };
      }
    }

    const lineRows = items.map((item, index) => {
      const product = productById.get(item.product_id.trim())!;
      const costRaw = Number(product.cost_price ?? 0);
      const unitCostPrice = Number.isFinite(costRaw) ? costRaw : 0;
      const discountAmount = Number(item.discount_amount ?? 0);
      const lineTotal = Number(item.line_total);

      return {
        document_id: documentId,
        product_id: product.id,
        description: (item.description?.trim() || product.name).slice(0, 255),
        qty: item.qty,
        uom_used: item.uom_used?.trim() || product.base_uom || "ตัว",
        unit_price: item.unit_price,
        unit_cost_price: unitCostPrice,
        discount_text: item.discount_text?.trim() || null,
        discount_amount: Number.isFinite(discountAmount) ? discountAmount : 0,
        line_total: Number.isFinite(lineTotal) ? lineTotal : 0,
        sort_order: item.sort_order ?? index,
      };
    });

    const subTotal = lineRows.reduce(
      (sum, row) => sum + Number(row.line_total),
      0,
    );
    const taxRate = Number(document.tax_rate ?? 7);
    const taxAmount =
      Number.isFinite(taxRate) && taxRate > 0
        ? Math.round(subTotal * (taxRate / 100) * 100) / 100
        : 0;
    const grandTotal = Math.round((subTotal + taxAmount) * 100) / 100;
    const nowIso = new Date().toISOString();
    const issuedStatus: DocumentStatus = "ISSUED";
    const draftStatus: DocumentStatus = "DRAFT";

    const { error: itemsError } = await supabase
      .from("document_items")
      .insert(lineRows);

    if (itemsError) {
      return {
        data: null,
        error: itemsError.message ?? "บันทึก document_items ไม่สำเร็จ",
      };
    }

    const { error: headerError } = await supabase
      .from("documents")
      .update({
        status: issuedStatus,
        sub_total: Math.round(subTotal * 100) / 100,
        tax_amount: taxAmount,
        grand_total: grandTotal,
        payment_status: resolveInitialPaymentStatus(document.doc_type as string),
        paid_amount:
          resolveInitialPaymentStatus(document.doc_type as string) === "PAID"
            ? grandTotal
            : 0,
        updated_at: nowIso,
      })
      .eq("id", documentId)
      .eq("status", "DRAFT");

    if (headerError) {
      await supabase.from("document_items").delete().eq("document_id", documentId);
      return {
        data: null,
        error: headerError.message ?? "อัปเดตสถานะเอกสารเป็น ISSUED ไม่สำเร็จ",
      };
    }

    const docType = document.doc_type as DocumentType;
    let ledgerCount = 0;

    if (isStockOutDocType(docType)) {
      const ledgerPayload = lineRows.map((row) => ({
        product_id: row.product_id,
        doc_header_id: null as string | null,
        trans_type: "OUT",
        qty: Math.round(Number(row.qty)),
        notes: `ขายจากเอกสาร ${document.doc_no} | document_id=${documentId} | SKU cost snapshot ${row.unit_cost_price}`,
      }));

      const { error: ledgerError } = await supabase
        .from("inventory_ledger")
        .insert(ledgerPayload);

      if (ledgerError) {
        await supabase
          .from("document_items")
          .delete()
          .eq("document_id", documentId);
        await supabase
          .from("documents")
          .update({
            status: draftStatus,
            sub_total: 0,
            tax_amount: 0,
            grand_total: 0,
            updated_at: nowIso,
          })
          .eq("id", documentId);

        return {
          data: null,
          error:
            ledgerError.message ??
            "ตัดสต็อก (inventory_ledger OUT) ไม่สำเร็จ — ยกเลิกการปิดบิลแล้ว",
        };
      }

      ledgerCount = ledgerPayload.length;
    }

    return {
      data: {
        document_id: documentId,
        doc_no: document.doc_no as string,
        status: issuedStatus,
        item_count: lineRows.length,
        ledger_count: ledgerCount,
        grand_total: grandTotal,
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "ปิดเอกสาร (completeDocument) ไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* getDocumentByNo                                                            */
/* -------------------------------------------------------------------------- */

type NestedProduct = {
  id: string;
  sku: string | null;
  name: string | null;
};

type NestedItemRow = {
  id: string;
  product_id: string | null;
  description: string | null;
  qty: number | string | null;
  uom_used: string | null;
  unit_price: number | string | null;
  unit_cost_price: number | string | null;
  discount_text: string | null;
  discount_amount: number | string | null;
  line_total: number | string | null;
  sort_order: number | null;
  products: NestedProduct | NestedProduct[] | null;
};

/**
 * Load a sales document by running number (`doc_no`) with items + customer.
 * Service Role only — never call from a browser Supabase client.
 */
export async function getDocumentByNo(
  docNo: string,
): Promise<GetDocumentByNoResult> {
  try {
    const trimmed = decodeURIComponent(docNo?.trim() ?? "");
    if (!trimmed) {
      return { data: null, error: "ไม่พบเลขที่เอกสาร" };
    }

    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        status,
        doc_date,
        due_date,
        contact_id,
        contact_person_id,
        sub_total,
        discount_amount,
        discount_text,
        tax_rate,
        tax_amount,
        grand_total,
        vat_type,
        vat_rate,
        total_amount,
        net_before_vat,
        vat_amount,
        wht_amount,
        payment_status,
        notes,
        attachment_url,
        attached_file_url,
        wht_attachment_url,
        original_receipt_url,
        created_at,
        updated_at,
        contacts:contact_id (
          id,
          company_name,
          tax_id,
          address,
          phone,
          branch_code
        ),
        contact_persons:contact_person_id (
          id,
          name,
          phone,
          email,
          department_or_role
        ),
        document_items (
          id,
          product_id,
          description,
          qty,
          uom_used,
          unit_price,
          unit_cost_price,
          discount_text,
          discount_amount,
          line_total,
          sort_order,
          products:product_id (
            id,
            sku,
            name
          )
        )
      `,
      )
      .eq("doc_no", trimmed)
      .maybeSingle();

    if (error) {
      return { data: null, error: error.message };
    }
    if (!data) {
      return { data: null, error: `ไม่พบเอกสารเลขที่ ${trimmed}` };
    }

    const contact = unwrapJoin(
      data.contacts as
        | DocumentDetail["contact"]
        | DocumentDetail["contact"][]
        | null,
    );
    const contactPerson = unwrapJoin(
      data.contact_persons as
        | DocumentDetail["contact_person"]
        | DocumentDetail["contact_person"][]
        | null,
    );

    const rawItems = Array.isArray(data.document_items)
      ? (data.document_items as NestedItemRow[])
      : [];

    const items: DocumentDetailItem[] = rawItems
      .map((row) => {
        const product = unwrapJoin(row.products);
        return {
          id: row.id,
          product_id: row.product_id,
          description: row.description,
          qty: Number(row.qty ?? 0),
          uom_used: row.uom_used,
          unit_price: Number(row.unit_price ?? 0),
          unit_cost_price: Number(row.unit_cost_price ?? 0),
          discount_text: row.discount_text,
          discount_amount: Number(row.discount_amount ?? 0),
          line_total: Number(row.line_total ?? 0),
          sort_order: Number(row.sort_order ?? 0),
          sku: product?.sku ?? null,
          product_name: product?.name ?? null,
        };
      })
      .sort((left, right) => left.sort_order - right.sort_order);

    const notes = (data.notes as string | null) ?? null;
    const vendorRefMatch = notes?.match(/อ้างอิงบิลซัพพลายเออร์:\s*(.+)$/m);
    const referenceNo = vendorRefMatch?.[1]?.trim() || null;

    const detail: DocumentDetail = {
      id: data.id as string,
      doc_no: data.doc_no as string,
      doc_type: data.doc_type as DocumentType,
      status: data.status as DocumentStatus,
      doc_date: String(data.doc_date),
      due_date: data.due_date ? String(data.due_date) : null,
      contact_id: data.contact_id as string,
      contact_person_id: (data.contact_person_id as string | null) ?? null,
      sub_total: Number(data.sub_total ?? 0),
      discount_amount: Number(data.discount_amount ?? 0),
      discount_text: (data.discount_text as string | null) ?? null,
      tax_rate: Number(data.tax_rate ?? 7),
      tax_amount: Number(data.tax_amount ?? 0),
      grand_total: Number(data.grand_total ?? 0),
      vat_type: (data.vat_type as DocumentDetail["vat_type"]) ?? null,
      vat_rate:
        data.vat_rate == null ? null : Number(data.vat_rate),
      total_amount:
        data.total_amount == null ? null : Number(data.total_amount),
      net_before_vat:
        data.net_before_vat == null ? null : Number(data.net_before_vat),
      vat_amount:
        data.vat_amount == null ? null : Number(data.vat_amount),
      wht_amount: Number(data.wht_amount ?? 0),
      payment_status: String(data.payment_status ?? "Pending"),
      notes,
      reference_no: referenceNo,
      attachment_url: (data.attachment_url as string | null) ?? null,
      attached_file_url: (data.attached_file_url as string | null) ?? null,
      wht_attachment_url: (data.wht_attachment_url as string | null) ?? null,
      original_receipt_url:
        (data.original_receipt_url as string | null) ?? null,
      created_at: String(data.created_at),
      updated_at: String(data.updated_at),
      contact,
      contact_person: contactPerson,
      items,
    };

    return { data: detail, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดเอกสารไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* issueDocument                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Confirm a DRAFT document → ISSUED (or COMPLETED for QT only)
 * and post inventory_ledger OUT rows when applicable.
 * Never mutates `products` stock directly — ledger only.
 */
export async function issueDocument(
  documentId: string,
): Promise<IssueDocumentResult> {
  try {
    const id = documentId?.trim() ?? "";
    if (!id) {
      return { data: null, error: "ไม่พบรหัสเอกสาร (document_id)" };
    }

    const supabase = createSupabaseServerClient();

    const { data: document, error: documentError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, status, grand_total, paid_amount")
      .eq("id", id)
      .maybeSingle();

    if (documentError) {
      return { data: null, error: documentError.message };
    }
    if (!document) {
      return { data: null, error: "ไม่พบเอกสารที่ระบุ" };
    }
    if (document.status !== "DRAFT") {
      return {
        data: null,
        error: `เอกสาร ${document.doc_no} ไม่ใช่สถานะ DRAFT (ปัจจุบัน: ${document.status})`,
      };
    }

    const { data: items, error: itemsError } = await supabase
      .from("document_items")
      .select("id, product_id, qty, description")
      .eq("document_id", id)
      .order("sort_order", { ascending: true });

    if (itemsError) {
      return { data: null, error: itemsError.message };
    }

    const lineItems = items ?? [];
    if (lineItems.length === 0) {
      return {
        data: null,
        error: "เอกสารไม่มีรายการสินค้า — ไม่สามารถออกเอกสารได้",
      };
    }

    const docType = document.doc_type as DocumentType;
    const issuedStatus = resolveIssuedDocumentStatus(docType);
    const paymentStatus = resolveInitialPaymentStatus(docType);
    const grandTotal = Number(document.grand_total ?? 0);
    const paidAmount =
      paymentStatus === "PAID" ? grandTotal : Number(document.paid_amount ?? 0);
    const nowIso = new Date().toISOString();

    const { error: statusError } = await supabase
      .from("documents")
      .update({
        status: issuedStatus,
        payment_status: paymentStatus,
        paid_amount: paidAmount,
        updated_at: nowIso,
      })
      .eq("id", id)
      .eq("status", "DRAFT");

    if (statusError) {
      return {
        data: null,
        error:
          statusError.message ??
          `อัปเดตสถานะเอกสารเป็น ${issuedStatus} ไม่สำเร็จ`,
      };
    }

    let ledgerCount = 0;

    if (isStockOutDocType(docType)) {
      const ledgerPayload = lineItems
        .filter((row) => Boolean(row.product_id))
        .map((row) => ({
          product_id: row.product_id as string,
          doc_header_id: null as string | null,
          trans_type: "OUT",
          qty: Math.round(Number(row.qty ?? 0)),
          notes: `ขายจากเอกสาร ${document.doc_no} | document_id=${id} | ออกเอกสาร ${issuedStatus}`,
        }))
        .filter((row) => row.qty > 0);

      if (ledgerPayload.length > 0) {
        const { error: ledgerError } = await supabase
          .from("inventory_ledger")
          .insert(ledgerPayload);

        if (ledgerError) {
          await supabase
            .from("documents")
            .update({
              status: "DRAFT" satisfies DocumentStatus,
              updated_at: nowIso,
            })
            .eq("id", id);

          return {
            data: null,
            error:
              ledgerError.message ??
              "ตัดสต็อก (inventory_ledger OUT) ไม่สำเร็จ — คืนสถานะ DRAFT แล้ว",
          };
        }

        ledgerCount = ledgerPayload.length;
      }
    }

    return {
      data: {
        document_id: id,
        document_no: document.doc_no as string,
        status: issuedStatus,
        ledger_count: ledgerCount,
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ออกเอกสาร (issueDocument) ไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/**
 * List sales documents (newest first) with customer name.
 * Optional URL-driven filters: search (doc_no / customer), doc_date from/to.
 * Service Role only — Zero Client-Side Fetching.
 */
export async function getSalesDocuments(
  filters?: DocumentListFilters,
  limit = 50,
): Promise<GetSalesDocumentsResult> {
  try {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const search = sanitizeSearch(filters?.search?.trim() ?? "");
    const from = normalizeDateParam(filters?.from);
    const to = normalizeDateParam(filters?.to);

    const supabase = createSupabaseServerClient();

    let contactIds: string[] = [];
    if (search) {
      const { data: matchedContacts, error: contactError } = await supabase
        .from("contacts")
        .select("id")
        .ilike("company_name", `%${search}%`)
        .limit(200);

      if (contactError) {
        return { data: [], error: contactError.message };
      }
      contactIds = (matchedContacts ?? []).map((c) => c.id as string);
    }

    // Base query — sales allow-list ONLY (blocks purchase PO/PAY leakage).
    let query = supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        status,
        doc_date,
        created_at,
        grand_total,
        contact_id,
        contacts:contact_id (
          company_name
        )
      `,
      )
      .in("doc_type", [...SALES_DOC_TYPES]);

    if (search) {
      const pattern = `%${search}%`;
      if (contactIds.length > 0) {
        query = query.or(
          `doc_no.ilike.${pattern},contact_id.in.(${contactIds.join(",")})`,
        );
      } else {
        query = query.ilike("doc_no", pattern);
      }
    }

    if (from) {
      query = query.gte("doc_date", from);
    }
    if (to) {
      query = query.lte("doc_date", to);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(safeLimit);

    if (error) {
      return { data: [], error: error.message };
    }

    const rows: SalesDocumentListItem[] = (data ?? []).map((row) => {
      const contact = Array.isArray(row.contacts)
        ? row.contacts[0]
        : row.contacts;

      return {
        id: row.id as string,
        doc_no: row.doc_no as string,
        doc_type: row.doc_type as DocumentType,
        status: row.status as DocumentStatus,
        doc_date: row.doc_date as string,
        created_at: row.created_at as string,
        grand_total: Number(row.grand_total ?? 0),
        contact_id: row.contact_id as string,
        customer_name:
          (contact as { company_name?: string | null } | null)?.company_name ??
          null,
      };
    });

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงรายการเอกสารขายไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * List purchase documents (newest first) with vendor name.
 * Optional URL-driven filters: search (doc_no / vendor name), doc_date from/to.
 * Note: documents has no dedicated vendor-ref column yet — search uses doc_no only
 * (+ contact name match). Vendor ref for display is parsed from notes.
 * Service Role only — Zero Client-Side Fetching.
 */
export async function getPurchaseDocuments(
  filters?: DocumentListFilters,
  limit = 50,
): Promise<GetPurchaseDocumentsResult> {
  try {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
    const search = sanitizeSearch(filters?.search?.trim() ?? "");
    const from = normalizeDateParam(filters?.from);
    const to = normalizeDateParam(filters?.to);

    const supabase = createSupabaseServerClient();

    let contactIds: string[] = [];
    if (search) {
      const { data: matchedContacts, error: contactError } = await supabase
        .from("contacts")
        .select("id")
        .ilike("company_name", `%${search}%`)
        .limit(200);

      if (contactError) {
        return { data: [], error: contactError.message };
      }
      contactIds = (matchedContacts ?? []).map((c) => c.id as string);
    }

    // Base query — purchase allow-list ONLY (blocks sales INV_DO/TAX_INV leakage).
    let query = supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        notes,
        doc_type,
        status,
        doc_date,
        created_at,
        grand_total,
        contact_id,
        contacts:contact_id (
          company_name
        )
      `,
      )
      .in("doc_type", [...PURCHASE_DOC_TYPES]);

    if (search) {
      const pattern = `%${search}%`;
      // doc_no only (+ vendor name) — no reference_no column on documents yet
      if (contactIds.length > 0) {
        query = query.or(
          `doc_no.ilike.${pattern},contact_id.in.(${contactIds.join(",")})`,
        );
      } else {
        query = query.ilike("doc_no", pattern);
      }
    }

    if (from) {
      query = query.gte("doc_date", from);
    }
    if (to) {
      query = query.lte("doc_date", to);
    }

    const { data, error } = await query
      .order("created_at", { ascending: false })
      .limit(safeLimit);

    if (error) {
      return { data: [], error: error.message };
    }

    const rows: PurchaseDocumentListItem[] = (data ?? []).map((row) => {
      const contact = Array.isArray(row.contacts)
        ? row.contacts[0]
        : row.contacts;
      const notes = (row.notes as string | null) ?? null;
      const vendorRefMatch = notes?.match(/อ้างอิงบิลซัพพลายเออร์:\s*(.+)$/m);
      const vendorRef = vendorRefMatch?.[1]?.trim() || null;

      return {
        id: row.id as string,
        doc_no: row.doc_no as string,
        reference_no: vendorRef,
        doc_type: row.doc_type as DocumentType,
        status: row.status as DocumentStatus,
        doc_date: row.doc_date as string,
        created_at: row.created_at as string,
        grand_total: Number(row.grand_total ?? 0),
        contact_id: row.contact_id as string,
        vendor_name:
          (contact as { company_name?: string | null } | null)?.company_name ??
          null,
      };
    });

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงรายการเอกสารซื้อไม่สำเร็จ";
    return { data: [], error: message };
  }
}

function normalizeDateParam(value?: string): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
  return trimmed;
}

/** Strip ILIKE / PostgREST filter metacharacters from user search. */
function sanitizeSearch(value: string): string {
  return value
    .replace(/[%_,()"\\]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Convert a COMPLETED Quotation (QT) into a new DRAFT sales document
 * (INV_DO / TAX_INV / ABB), copying header commercial fields + line items.
 * Service Role only — Zero Client-Side Fetching.
 */
export async function convertDocument(
  sourceDocId: string,
  targetDocType: ConvertTargetDocType,
): Promise<ConvertDocumentResult> {
  try {
    const id = sourceDocId?.trim() ?? "";
    if (!id) {
      return { data: null, error: "ไม่พบรหัสเอกสารต้นทาง" };
    }
    if (!isConvertTargetDocType(targetDocType)) {
      return {
        data: null,
        error: "ประเภทเอกสารปลายทางไม่ถูกต้อง (รองรับ INV_DO, TAX_INV, ABB)",
      };
    }

    const supabase = createSupabaseServerClient();

    const { data: source, error: sourceError } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        status,
        doc_date,
        due_date,
        contact_id,
        contact_person_id,
        sub_total,
        discount_amount,
        discount_text,
        tax_rate,
        tax_amount,
        wht_rate,
        wht_amount,
        grand_total,
        deposit_deducted,
        vat_type,
        vat_rate,
        total_amount,
        net_before_vat,
        vat_amount,
        notes,
        document_items (
          product_id,
          description,
          qty,
          uom_used,
          unit_price,
          unit_cost_price,
          discount_text,
          discount_amount,
          line_total,
          sort_order
        )
      `,
      )
      .eq("id", id)
      .maybeSingle();

    if (sourceError) {
      return { data: null, error: sourceError.message };
    }
    if (!source) {
      return { data: null, error: "ไม่พบเอกสารต้นทาง" };
    }
    if (source.doc_type !== "QT") {
      return {
        data: null,
        error: "แปลงเอกสารได้เฉพาะใบเสนอราคา (QT) เท่านั้น",
      };
    }
    if (source.status !== "COMPLETED") {
      return {
        data: null,
        error: "แปลงเอกสารได้เมื่อสถานะเป็น COMPLETED เท่านั้น",
      };
    }
    if (!source.contact_id) {
      return { data: null, error: "เอกสารต้นทางไม่มีข้อมูลลูกค้า" };
    }

    const docDate = new Date().toISOString().slice(0, 10);
    const numberResult = await generateDocumentNumber(targetDocType, docDate);
    if (numberResult.error || !numberResult.data) {
      return {
        data: null,
        error: numberResult.error ?? "สร้างเลขที่เอกสารใหม่ไม่สำเร็จ",
      };
    }

    const newDocNo = numberResult.data;
    const draftStatus: DocumentStatus = "DRAFT";
    const nowIso = new Date().toISOString();
    const sourceItems = Array.isArray(source.document_items)
      ? source.document_items
      : [];

    const refNote = `แปลงจาก ${source.doc_no}`;
    const notes =
      typeof source.notes === "string" && source.notes.trim()
        ? `${source.notes.trim()}\n${refNote}`
        : refNote;

    const { data: created, error: createError } = await supabase
      .from("documents")
      .insert({
        doc_no: newDocNo,
        doc_type: targetDocType,
        status: draftStatus,
        doc_date: docDate,
        due_date: source.due_date ?? null,
        contact_id: source.contact_id,
        contact_person_id: source.contact_person_id ?? null,
        ref_document_id: source.id,
        // Keep legacy column in sync when present in older environments.
        ref_doc_id: source.id,
        sub_total: Number(source.sub_total ?? 0),
        discount_amount: Number(source.discount_amount ?? 0),
        discount_text: source.discount_text ?? null,
        tax_rate: Number(source.tax_rate ?? 7),
        tax_amount: Number(source.tax_amount ?? 0),
        wht_rate: Number(source.wht_rate ?? 0),
        wht_amount: Number(source.wht_amount ?? 0),
        grand_total: Number(source.grand_total ?? 0),
        deposit_deducted: Number(source.deposit_deducted ?? 0),
        vat_type: source.vat_type ?? "EXCLUSIVE",
        vat_rate: Number(source.vat_rate ?? source.tax_rate ?? 7),
        total_amount: Number(source.total_amount ?? source.sub_total ?? 0),
        net_before_vat: Number(source.net_before_vat ?? 0),
        vat_amount: Number(source.vat_amount ?? source.tax_amount ?? 0),
        payment_status: resolveInitialPaymentStatus(targetDocType),
        notes,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (createError || !created) {
      return {
        data: null,
        error: createError?.message ?? "สร้างเอกสารปลายทางไม่สำเร็จ",
      };
    }

    const newDocumentId = created.id as string;

    if (sourceItems.length > 0) {
      const itemsPayload = sourceItems.map((item, index) => ({
        document_id: newDocumentId,
        product_id: item.product_id ?? null,
        description: item.description ?? null,
        qty: Number(item.qty ?? 0),
        uom_used: item.uom_used ?? null,
        unit_price: Number(item.unit_price ?? 0),
        unit_cost_price: Number(item.unit_cost_price ?? 0),
        discount_text: item.discount_text ?? null,
        discount_amount: Number(item.discount_amount ?? 0),
        line_total: Number(item.line_total ?? 0),
        sort_order:
          typeof item.sort_order === "number" ? item.sort_order : index,
      }));

      const { error: itemsError } = await supabase
        .from("document_items")
        .insert(itemsPayload);

      if (itemsError) {
        await supabase.from("documents").delete().eq("id", newDocumentId);
        return {
          data: null,
          error:
            itemsError.message ??
            "คัดลอกรายการสินค้าไปเอกสารใหม่ไม่สำเร็จ — ยกเลิกเอกสารร่างแล้ว",
        };
      }
    }

    return {
      data: {
        document_id: newDocumentId,
        doc_no: (created.doc_no as string) || newDocNo,
        doc_type: targetDocType,
      },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "แปลงเอกสารไม่สำเร็จ";
    return { data: null, error: message };
  }
}

/**
 * Upload a bill / document image to Storage bucket `document_attachments`.
 * Service Role only — Zero Client-Side Fetching.
 *
 * FormData keys: `file` (File | Blob)
 */
export async function uploadDocumentImage(
  formData: FormData,
): Promise<UploadDocumentImageResult> {
  try {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size === 0) {
      return { data: null, error: "ไม่พบไฟล์ภาพสำหรับอัปโหลด" };
    }

    const mimeType = (file.type || "").toLowerCase();
    if (mimeType && !ALLOWED_ATTACHMENT_MIME_TYPES.has(mimeType)) {
      return {
        data: null,
        error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP/GIF/PDF`,
      };
    }

    const maxBytes = 10 * 1024 * 1024;
    if (file.size > maxBytes) {
      return { data: null, error: "ไฟล์ใหญ่เกิน 10MB" };
    }

    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const safeName = file.name
      .replace(/[^\w.\-ก-๙]+/g, "_")
      .replace(/_+/g, "_")
      .slice(0, 120);
    const extFromName = safeName.includes(".")
      ? safeName.slice(safeName.lastIndexOf("."))
      : mimeType === "application/pdf"
        ? ".pdf"
        : mimeType === "image/png"
          ? ".png"
          : mimeType === "image/webp"
            ? ".webp"
            : mimeType === "image/gif"
              ? ".gif"
              : ".jpg";
    const objectPath = `goods-receipt/${yyyy}/${mm}/${crypto.randomUUID()}${extFromName}`;

    const supabase = createSupabaseServerClient();
    const buffer = Buffer.from(await file.arrayBuffer());

    const { error: uploadError } = await supabase.storage
      .from(DOCUMENT_ATTACHMENTS_BUCKET)
      .upload(objectPath, buffer, {
        contentType: mimeType || "application/octet-stream",
        upsert: false,
      });

    if (uploadError) {
      return {
        data: null,
        error: uploadError.message ?? "อัปโหลดไฟล์ภาพขึ้น Storage ไม่สำเร็จ",
      };
    }

    const { data: publicData } = supabase.storage
      .from(DOCUMENT_ATTACHMENTS_BUCKET)
      .getPublicUrl(objectPath);

    const url = publicData?.publicUrl?.trim();
    if (!url) {
      return {
        data: null,
        error: "อัปโหลดสำเร็จ แต่สร้าง URL ของไฟล์ไม่ได้",
      };
    }

    return {
      data: { url, path: objectPath },
      error: null,
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "อัปโหลดภาพเอกสารไม่สำเร็จ";
    return { data: null, error: message };
  }
}
