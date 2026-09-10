"use server";

/**
 * Phase 18 — AR Credit Note (CN) Server Actions.
 * Zero Client-Side Fetching: supabaseAdmin (Service Role) only.
 * Types live in `types/credit-note.ts`.
 */

import { revalidatePath } from "next/cache";
import {
  CREDIT_NOTE_SOURCE_DOC_TYPES,
  CREDIT_NOTE_SOURCE_STATUSES,
  resolveInitialPaymentStatus,
} from "@/lib/constants/document";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { generateDraftDocumentNo } from "@/lib/utils/draft-document-no";
import {
  calculateDocumentSummary,
  isVatCalculationType,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import {
  encodeCreditNoteLineDescription,
  parseCreditNoteLineMeta,
  qtyExceedsLimit,
  remainingQty,
  stripCreditNoteLineMeta,
} from "@/lib/utils/credit-note-line";
import type {
  CreateCreditNoteInput,
  CreateCreditNoteResult,
  CreditNoteSourceDocument,
  CreditNoteSourceItem,
  GetCreditNoteSourceResult,
} from "@/types/credit-note";
import type { DocumentStatus, DocumentType } from "@/types/document";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SourceItemRow = {
  id: string;
  product_id: string | null;
  description: string | null;
  qty: number | string | null;
  uom_used: string | null;
  unit_price: number | string | null;
  unit_cost_price: number | string | null;
  discount_amount: number | string | null;
  line_total: number | string | null;
  sort_order: number | string | null;
  products?: {
    id?: string;
    sku?: string | null;
    name?: string | null;
    product_models?: {
      image_url?: string | null;
      is_service?: boolean | null;
    } | null;
  } | null;
};

type ExistingCnRow = {
  id: string;
  grand_total: number | string | null;
  status: string | null;
  document_items?: {
    product_id: string | null;
    qty: number | string | null;
    description: string | null;
  }[];
};

function isCreditNoteSourceType(value: string): boolean {
  return (CREDIT_NOTE_SOURCE_DOC_TYPES as readonly string[]).includes(value);
}

function isCreditNoteSourceStatus(value: string): boolean {
  return (CREDIT_NOTE_SOURCE_STATUSES as readonly string[]).includes(value);
}

function toQty(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function prorateLineDiscount(
  sourceDiscount: number,
  sourceQty: number,
  cnQty: number,
): number {
  if (sourceQty <= 0 || sourceDiscount <= 0 || cnQty <= 0) return 0;
  return roundMoney(sourceDiscount * (cnQty / sourceQty));
}

function resolveCnDiscountText(params: {
  sourceDiscountText: string | null;
  sourceDiscountAmount: number;
  sourceTotalAmount: number;
  cnLineSum: number;
}): string | null {
  const text = params.sourceDiscountText?.trim() || "";
  if (!text) return null;
  if (text.includes("%")) return text;
  if (params.sourceTotalAmount <= 0 || params.sourceDiscountAmount <= 0) {
    return null;
  }
  const prorated = roundMoney(
    params.sourceDiscountAmount *
      (params.cnLineSum / params.sourceTotalAmount),
  );
  return prorated > 0 ? String(prorated) : null;
}

function accumulateCreditedQty(
  sourceItems: { id: string; product_id: string; qty: number }[],
  existingLines: {
    product_id: string | null;
    qty: number;
    description: string | null;
  }[],
): Map<string, number> {
  const credited = new Map<string, number>();
  const unmatched: { product_id: string; qty: number }[] = [];

  for (const line of existingLines) {
    const qty = toQty(line.qty);
    if (qty <= 0) continue;
    const meta = parseCreditNoteLineMeta(line.description);
    if (meta?.sourceItemId) {
      credited.set(
        meta.sourceItemId,
        (credited.get(meta.sourceItemId) ?? 0) + qty,
      );
      continue;
    }
    const productId = String(line.product_id ?? "").trim();
    if (productId) unmatched.push({ product_id: productId, qty });
  }

  for (const leftover of unmatched) {
    let need = leftover.qty;
    for (const source of sourceItems) {
      if (need <= 0.00005) break;
      if (source.product_id !== leftover.product_id) continue;
      const already = credited.get(source.id) ?? 0;
      const room = remainingQty(source.qty, already);
      if (room <= 0) continue;
      const take = need < room ? need : room;
      credited.set(source.id, already + take);
      need -= take;
    }
  }

  return credited;
}

function mapSourceItems(
  rows: SourceItemRow[],
  creditedByItem: Map<string, number>,
): CreditNoteSourceItem[] {
  return [...rows]
    .sort((a, b) => toQty(a.sort_order) - toQty(b.sort_order))
    .flatMap((row) => {
      const productId = String(row.product_id ?? "").trim();
      if (!productId) return [];
      const product = unwrapJoin(row.products);
      const model = unwrapJoin(product?.product_models);
      const sourceQty = toQty(row.qty);
      const creditedQty = creditedByItem.get(row.id) ?? 0;
      const left = remainingQty(sourceQty, creditedQty);
      return [
        {
          source_item_id: row.id,
          product_id: productId,
          sku: product?.sku?.trim() || null,
          description:
            stripCreditNoteLineMeta(row.description) ||
            String(product?.name ?? "").trim() ||
            "—",
          image_url: model?.image_url?.trim() || null,
          is_service: model?.is_service === true,
          uom_used: String(row.uom_used ?? "").trim() || "ตัว",
          source_qty: sourceQty,
          credited_qty: creditedQty,
          remaining_qty: left,
          unit_price: toQty(row.unit_price),
          unit_cost_price: toQty(row.unit_cost_price),
          discount_amount: toQty(row.discount_amount),
          line_total: toQty(row.line_total),
          sort_order: toQty(row.sort_order),
        },
      ];
    });
}

export async function getCreditNoteSourceAction(
  refDocumentId: string,
): Promise<GetCreditNoteSourceResult> {
  try {
    const id = refDocumentId?.trim() ?? "";
    if (!id || !UUID_RE.test(id)) {
      return {
        data: null,
        error: "รหัสบิลต้นทางไม่ถูกต้อง — ต้องระบุ ref_doc_id เป็น UUID",
      };
    }

    const supabaseAdmin = createSupabaseServerClient();

    const { data: source, error: sourceError } = await supabaseAdmin
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        status,
        doc_date,
        contact_id,
        contact_person_id,
        vat_type,
        vat_rate,
        discount_text,
        discount_amount,
        total_amount,
        sub_total,
        grand_total,
        contacts:contact_id (
          company_name
        ),
        document_items!document_items_document_id_fkey (
          id,
          product_id,
          description,
          qty,
          uom_used,
          unit_price,
          unit_cost_price,
          discount_amount,
          line_total,
          sort_order,
          products!document_items_product_id_fkey (
            id,
            sku,
            name,
            product_models!products_model_id_fkey (
              image_url,
              is_service
            )
          )
        )
      `,
      )
      .eq("id", id)
      .maybeSingle();

    if (sourceError) {
      return { data: null, error: sourceError.message };
    }
    if (!source) {
      return { data: null, error: "ไม่พบบิลขายต้นทาง" };
    }

    const docType = String(source.doc_type ?? "");
    const status = String(source.status ?? "");
    if (!isCreditNoteSourceType(docType)) {
      return {
        data: null,
        error: `เอกสาร ${source.doc_no} ประเภท ${docType} ไม่สามารถออกใบลดหนี้ได้ (ใช้ได้เฉพาะ INV_DO / TAX_INV / CS_TAX / ABB)`,
      };
    }
    if (!isCreditNoteSourceStatus(status)) {
      return {
        data: null,
        error: `บิลต้นทางต้องมีสถานะ ISSUED / COMPLETED / PAID (ปัจจุบัน: ${status || "—"})`,
      };
    }

    const { data: existingCn, error: cnError } = await supabaseAdmin
      .from("documents")
      .select(
        `
        id,
        grand_total,
        status,
        document_items!document_items_document_id_fkey (
          product_id,
          qty,
          description
        )
      `,
      )
      .eq("ref_document_id", id)
      .eq("doc_type", "CN")
      .not("status", "in", '("VOID","CANCELLED")');

    if (cnError) {
      return { data: null, error: cnError.message };
    }

    const cnRows = (existingCn ?? []) as ExistingCnRow[];
    const creditedGrand = cnRows.reduce(
      (sum, row) => sum + toQty(row.grand_total),
      0,
    );
    const sourceItemRows = (source.document_items ?? []) as SourceItemRow[];
    const sourceKeys = sourceItemRows
      .map((row) => ({
        id: row.id,
        product_id: String(row.product_id ?? "").trim(),
        qty: toQty(row.qty),
      }))
      .filter((row) => row.product_id);

    const existingLines = cnRows.flatMap((row) =>
      (row.document_items ?? []).map((item) => ({
        product_id: item.product_id,
        qty: toQty(item.qty),
        description: item.description,
      })),
    );
    const creditedByItem = accumulateCreditedQty(sourceKeys, existingLines);
    const items = mapSourceItems(sourceItemRows, creditedByItem);

    const contact = unwrapJoin(source.contacts as { company_name?: string } | { company_name?: string }[] | null);
    const sourceGrand = toQty(source.grand_total);
    const vatTypeRaw = String(source.vat_type ?? "EXCLUSIVE");
    const vatType: VatCalculationType = isVatCalculationType(vatTypeRaw)
      ? vatTypeRaw
      : "EXCLUSIVE";

    const payload: CreditNoteSourceDocument = {
      id: String(source.id),
      doc_no: String(source.doc_no ?? ""),
      doc_type: docType as DocumentType,
      status: status as DocumentStatus,
      doc_date: String(source.doc_date ?? "").slice(0, 10),
      contact_id: String(source.contact_id ?? ""),
      contact_person_id: source.contact_person_id
        ? String(source.contact_person_id)
        : null,
      customer_name: String(contact?.company_name ?? "—"),
      vat_type: vatType,
      vat_rate: toQty(source.vat_rate) || 7,
      discount_text: source.discount_text
        ? String(source.discount_text)
        : null,
      discount_amount: toQty(source.discount_amount),
      total_amount: toQty(source.total_amount ?? source.sub_total),
      grand_total: sourceGrand,
      remaining_grand_total: remainingQty(sourceGrand, creditedGrand),
      items,
    };

    return { data: payload, error: null };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error
          ? err.message
          : "โหลดบิลขายต้นทางสำหรับใบลดหนี้ไม่สำเร็จ",
    };
  }
}

/**
 * สร้างใบลดหนี้ DRAFT จากบิลขายต้นทาง — Late Numbering
 * `DRAFT-YYYYMMDDHHmmss` และผูก `ref_document_id`
 */
export async function createCreditNoteAction(
  payload: CreateCreditNoteInput,
): Promise<CreateCreditNoteResult> {
  try {
    const refId = payload?.ref_document_id?.trim() ?? "";
    const notes =
      typeof payload?.notes === "string"
        ? payload.notes.trim() || null
        : null;
    const incoming = Array.isArray(payload?.items) ? payload.items : [];
    const docDate =
      typeof payload?.doc_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(payload.doc_date.trim())
        ? payload.doc_date.trim()
        : new Date().toISOString().slice(0, 10);

    if (!refId || !UUID_RE.test(refId)) {
      return {
        data: null,
        error: "ต้องระบุบิลขายต้นทาง (ref_document_id) เป็น UUID",
      };
    }

    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { data: null, error: owner.error };
    }

    const sourceResult = await getCreditNoteSourceAction(refId);
    if (!sourceResult.data) {
      return { data: null, error: sourceResult.error ?? "ไม่พบบิลขายต้นทาง" };
    }
    const source = sourceResult.data;

    const supabaseAdmin = createSupabaseServerClient();
    const { data: periodClosed, error: periodError } = await supabaseAdmin.rpc(
      "is_period_closed",
      { doc_date: docDate },
    );
    if (periodError) {
      return { data: null, error: periodError.message };
    }
    if (periodClosed === true) {
      return {
        data: null,
        error: "งวดบัญชีของวันที่เอกสารนี้ถูกปิดแล้ว ไม่สามารถสร้างใบลดหนี้ได้",
      };
    }

    const sourceById = new Map(
      source.items.map((item) => [item.source_item_id, item]),
    );
    const selected: {
      source: CreditNoteSourceItem;
      qty: number;
      unitPrice: number;
      returnToInventory: boolean;
    }[] = [];

    for (const [index, line] of incoming.entries()) {
      const sourceItemId = line.source_item_id?.trim() ?? "";
      const qty = toQty(line.qty);
      if (!sourceItemId || qty <= 0) continue;

      const origin = sourceById.get(sourceItemId);
      if (!origin) {
        return {
          data: null,
          error: `รายการที่ ${index + 1}: ไม่พบในบิลต้นทาง`,
        };
      }
      if (qtyExceedsLimit(qty, origin.remaining_qty)) {
        return {
          data: null,
          error: `รายการ ${origin.sku ?? origin.description}: จำนวนลดหนี้เกินยอดคงเหลือ (${origin.remaining_qty})`,
        };
      }

      const requestedPrice =
        line.unit_price == null ? origin.unit_price : Number(line.unit_price);
      if (!Number.isFinite(requestedPrice) || requestedPrice < 0) {
        return {
          data: null,
          error: `รายการ ${origin.sku ?? origin.description}: ราคา/หน่วยไม่ถูกต้อง`,
        };
      }
      const unitPrice = roundMoney(requestedPrice);

      selected.push({
        source: origin,
        qty,
        unitPrice,
        returnToInventory: origin.is_service
          ? false
          : Boolean(line.return_to_inventory),
      });
    }

    if (selected.length === 0) {
      return {
        data: null,
        error: "กรุณาระบุจำนวนลดหนี้อย่างน้อย 1 รายการ",
      };
    }

    const lineRows = selected.map((row, index) => {
      const discountAmount = prorateLineDiscount(
        row.source.discount_amount,
        row.source.source_qty,
        row.qty,
      );
      const lineTotal = roundMoney(
        row.qty * row.unitPrice - discountAmount,
      );
      return {
        product_id: row.source.product_id,
        description: encodeCreditNoteLineDescription({
          sourceItemId: row.source.source_item_id,
          returnToInventory: row.returnToInventory,
          description: row.source.description,
        }),
        qty: row.qty,
        uom_used: row.source.uom_used,
        unit_price: row.unitPrice,
        unit_cost_price: row.source.unit_cost_price,
        discount_text: null,
        discount_amount: discountAmount,
        line_total: lineTotal,
        sort_order: row.source.sort_order || index,
      };
    });

    const cnLineSum = lineRows.reduce((sum, row) => sum + row.line_total, 0);
    const discountText = resolveCnDiscountText({
      sourceDiscountText: source.discount_text,
      sourceDiscountAmount: source.discount_amount,
      sourceTotalAmount: source.total_amount,
      cnLineSum,
    });

    const summary = calculateDocumentSummary({
      lineTotals: lineRows.map((row) => row.line_total),
      discountText,
      vatType: source.vat_type,
      vatRate: source.vat_rate,
    });

    if (qtyExceedsLimit(summary.grand_total, source.remaining_grand_total)) {
      return {
        data: null,
        error: `ยอดใบลดหนี้ ${summary.grand_total.toFixed(2)} เกินยอดคงเหลือของบิลต้นทาง (${source.remaining_grand_total.toFixed(2)})`,
      };
    }

    const documentNo = generateDraftDocumentNo();
    const nowIso = new Date().toISOString();
    const draftStatus: DocumentStatus = "DRAFT";

    const { data: document, error: documentError } = await supabaseAdmin
      .from("documents")
      .insert({
        doc_no: documentNo,
        doc_type: "CN",
        status: draftStatus,
        doc_date: docDate,
        contact_id: source.contact_id,
        contact_person_id: source.contact_person_id,
        ref_document_id: source.id,
        sub_total: summary.total_amount,
        discount_amount: summary.discount_amount,
        tax_rate: summary.vat_rate,
        tax_amount: summary.vat_amount,
        grand_total: summary.grand_total,
        vat_type: summary.vat_type,
        vat_rate: summary.vat_rate,
        total_amount: summary.total_amount,
        net_before_vat: summary.net_before_vat,
        vat_amount: summary.vat_amount,
        discount_text: discountText,
        notes,
        payment_status: resolveInitialPaymentStatus("CN"),
        created_by: owner.userId,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (documentError || !document) {
      return {
        data: null,
        error: documentError?.message ?? "บันทึกใบลดหนี้ร่างไม่สำเร็จ",
      };
    }

    const documentId = document.id as string;
    const { error: itemsError } = await supabaseAdmin
      .from("document_items")
      .insert(
        lineRows.map((row) => ({
          ...row,
          document_id: documentId,
        })),
      );

    if (itemsError) {
      await supabaseAdmin.from("documents").delete().eq("id", documentId);
      return {
        data: null,
        error: itemsError.message ?? "บันทึกรายการใบลดหนี้ไม่สำเร็จ",
      };
    }

    revalidatePath("/sales");
    revalidatePath(`/sales/${encodeURIComponent(source.doc_no)}`);
    revalidatePath("/sales/cn/create");

    void logAuditTrail(
      "documents",
      documentId,
      "INSERT",
      null,
      {
        id: documentId,
        doc_no: String(document.doc_no ?? documentNo),
        doc_type: "CN",
        status: draftStatus,
        ref_document_id: source.id,
        grand_total: summary.grand_total,
        audit_event: "CREATE",
      },
    );

    return {
      data: {
        document_id: documentId,
        document_no: String(document.doc_no ?? documentNo),
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error
          ? err.message
          : "สร้างใบลดหนี้ (createCreditNoteAction) ไม่สำเร็จ",
    };
  }
}
