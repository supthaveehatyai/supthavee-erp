"use server";

/**
 * Phase 14 — Inventory Adjustment (STK_OB / STK_ADJ).
 * Ledger-Driven: inventory_ledger only — never mutate products stock directly.
 * Zero Client-Side Fetching: Service Role (`createClient`) only.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import { generateDocumentNumber } from "@/lib/actions/document-actions";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { getSystemSettings } from "@/lib/actions/settings";
import {
  INVENTORY_DOC_TYPES,
  resolveInitialPaymentStatus,
  resolveIssuedDocumentStatus,
} from "@/lib/constants/document";
import {
  assertStockOutAvailability,
  excludeServiceLines,
  loadServiceProductIdSet,
} from "@/lib/inventory/stock-availability";
import type {
  AdjustInventoryInput,
  AdjustInventoryResult,
  AdjustmentDetail,
  AdjustmentDetailItem,
  GetAdjustmentDetailResult,
  GetInventoryAdjustmentsResult,
  InventoryAdjustmentLineInput,
  InventoryAdjustmentListItem,
} from "@/types/inventory-adjustment";
import type { DocumentType } from "@/types/document";

const MONEY_EPS = 0.0001;

function roundCost(value: number): number {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function isInventoryDocType(value: string): value is "STK_OB" | "STK_ADJ" {
  return (INVENTORY_DOC_TYPES as readonly string[]).includes(value);
}

function normalizeLines(
  docType: "STK_OB" | "STK_ADJ",
  raw: InventoryAdjustmentLineInput[],
): { ok: true; lines: InventoryAdjustmentLineInput[] } | { ok: false; error: string } {
  const merged = new Map<string, InventoryAdjustmentLineInput>();

  for (const row of raw) {
    const productId = row.product_id?.trim() ?? "";
    if (!productId) continue;

    const qtyRaw = Number(row.qty);
    if (!Number.isFinite(qtyRaw) || qtyRaw === 0) continue;

    if (docType === "STK_OB") {
      if (qtyRaw <= 0) {
        return {
          ok: false,
          error: "ยอดยกมา (STK_OB) ต้องเป็นจำนวนบวกเท่านั้น",
        };
      }
      const cost = roundCost(Number(row.unit_cost_price ?? 0));
      if (cost < 0) {
        return { ok: false, error: "ต้นทุนต่อหน่วยต้องไม่ติดลบ" };
      }
      merged.set(productId, {
        product_id: productId,
        qty: Math.trunc(qtyRaw),
        unit_cost_price: cost,
      });
      continue;
    }

    // STK_ADJ — signed qty
    const qty = Math.trunc(qtyRaw);
    if (qty === 0) continue;

    const existing = merged.get(productId);
    if (existing) {
      merged.set(productId, {
        ...existing,
        qty: existing.qty + qty,
        unit_cost_price:
          qty > 0 && row.unit_cost_price != null
            ? roundCost(Number(row.unit_cost_price))
            : existing.unit_cost_price,
      });
    } else {
      merged.set(productId, {
        product_id: productId,
        qty,
        unit_cost_price:
          qty > 0 && row.unit_cost_price != null
            ? roundCost(Number(row.unit_cost_price))
            : undefined,
      });
    }
  }

  const lines = [...merged.values()].filter((line) => line.qty !== 0);
  if (lines.length === 0) {
    return { ok: false, error: "ต้องมีอย่างน้อย 1 รายการสินค้าที่มียอดปรับปรุง" };
  }

  for (const line of lines) {
    if (docType === "STK_OB") continue;
    if (line.qty > 0 && line.unit_cost_price != null && line.unit_cost_price < 0) {
      return { ok: false, error: "ต้นทุนต่อหน่วยต้องไม่ติดลบ" };
    }
  }

  return { ok: true, lines };
}

/**
 * List STK_OB / STK_ADJ documents (newest first).
 */
export async function getInventoryAdjustments(): Promise<GetInventoryAdjustmentsResult> {
  try {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        status,
        doc_date,
        notes,
        created_at,
        document_items!document_items_document_id_fkey (
          id,
          qty,
          unit_cost_price
        )
      `,
      )
      .in("doc_type", [...INVENTORY_DOC_TYPES])
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      return { data: [], error: error.message ?? "ดึงรายการปรับปรุงสต็อกไม่สำเร็จ" };
    }

    type ItemRow = {
      id?: string;
      qty?: number | string | null;
      unit_cost_price?: number | string | null;
    };

    type DocRow = {
      id: string;
      doc_no: string;
      doc_type: string;
      status: string;
      doc_date: string;
      notes: string | null;
      created_at: string;
      document_items: ItemRow | ItemRow[] | null;
    };

    const rows: InventoryAdjustmentListItem[] = ((data ?? []) as DocRow[]).map(
      (doc) => {
        const items = Array.isArray(doc.document_items)
          ? doc.document_items
          : doc.document_items
            ? [doc.document_items]
            : [];

        let totalIn = 0;
        let totalOut = 0;
        for (const item of items) {
          const q = Math.trunc(Number(item.qty ?? 0));
          if (q > 0) totalIn += q;
          else if (q < 0) totalOut += Math.abs(q);
        }

        return {
          id: doc.id,
          doc_no: doc.doc_no,
          doc_type: doc.doc_type as InventoryAdjustmentListItem["doc_type"],
          status: doc.status,
          doc_date: doc.doc_date,
          remark: doc.notes,
          line_count: items.length,
          total_in_qty: totalIn,
          total_out_qty: totalOut,
          created_at: doc.created_at,
        };
      },
    );

    return { data: rows, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงรายการปรับปรุงสต็อกไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * Post opening balance (STK_OB) or stock adjustment (STK_ADJ).
 * Issues document immediately with official running number (Late Numbering).
 */
export async function adjustInventory(
  input: AdjustInventoryInput,
): Promise<AdjustInventoryResult> {
  const supabase = createClient();
  let documentId: string | null = null;

  try {
    const docType = input.doc_type;
    if (!isInventoryDocType(docType)) {
      return { success: false, error: "ประเภทเอกสารต้องเป็น STK_OB หรือ STK_ADJ" };
    }

    const docDate = input.doc_date?.trim() ?? "";
    if (!isIsoDate(docDate)) {
      return {
        success: false,
        error: "วันที่เอกสารต้องเป็นรูปแบบ YYYY-MM-DD",
      };
    }

    const remark = input.remark?.trim() ?? "";
    if (docType === "STK_ADJ" && !remark) {
      return {
        success: false,
        error: "เอกสารปรับปรุงสต็อก (STK_ADJ) ต้องระบุเหตุผล (Remark)",
      };
    }

    const normalized = normalizeLines(docType, input.lines ?? []);
    if (!normalized.ok) {
      return { success: false, error: normalized.error };
    }
    const lines = normalized.lines;

    const productIds = lines.map((line) => line.product_id);
    const serviceIds = await loadServiceProductIdSet(supabase, productIds);
    const stockLines = excludeServiceLines(lines, serviceIds);
    if (stockLines.length === 0) {
      return {
        success: false,
        error: "ไม่พบรายการสินค้าที่ตัดสต็อกได้ (งานบริการถูกข้าม)",
      };
    }

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, sku, name, cost_price, is_active")
      .in("id", stockLines.map((l) => l.product_id));

    if (productsError) {
      return {
        success: false,
        error: productsError.message ?? "โหลดข้อมูลสินค้าไม่สำเร็จ",
      };
    }

    const productMap = new Map(
      (products ?? []).map((row) => [String(row.id), row]),
    );
    for (const line of stockLines) {
      const product = productMap.get(line.product_id);
      if (!product || product.is_active === false) {
        return {
          success: false,
          error: `ไม่พบสินค้าที่ใช้งานได้: ${line.product_id}`,
        };
      }
      if (docType === "STK_OB") {
        const cost = roundCost(Number(line.unit_cost_price ?? 0));
        if (cost <= 0) {
          return {
            success: false,
            error: `ยอดยกมาต้องระบุต้นทุนต่อหน่วยสำหรับ SKU ${product.sku ?? line.product_id}`,
          };
        }
      }
    }

    const outDemands = stockLines
      .filter((line) => docType === "STK_ADJ" && line.qty < 0)
      .map((line) => ({
        product_id: line.product_id,
        qty: Math.abs(line.qty),
      }));

    if (outDemands.length > 0) {
      const settingsResult = await getSystemSettings();
      const allowNegative =
        settingsResult.success &&
        Boolean(settingsResult.data.allow_negative_inventory);
      const stockCheck = await assertStockOutAvailability(
        supabase,
        outDemands,
        allowNegative,
      );
      if (!stockCheck.ok) {
        return { success: false, error: stockCheck.error };
      }
    }

    const numberResult = await generateDocumentNumber(
      docType as DocumentType,
      docDate,
    );
    if (!numberResult.data) {
      return {
        success: false,
        error: numberResult.error ?? "สร้างเลขที่เอกสารไม่สำเร็จ",
      };
    }
    const docNo = numberResult.data;
    const nowIso = new Date().toISOString();
    const issuedStatus = resolveIssuedDocumentStatus(docType);
    const paymentStatus = resolveInitialPaymentStatus(docType);

    const { data: document, error: docError } = await supabase
      .from("documents")
      .insert({
        doc_no: docNo,
        doc_type: docType,
        status: issuedStatus,
        doc_date: docDate,
        contact_id: null,
        sub_total: 0,
        discount_amount: 0,
        tax_rate: 0,
        tax_amount: 0,
        wht_rate: 0,
        wht_amount: 0,
        grand_total: 0,
        total_amount: 0,
        net_before_vat: 0,
        vat_amount: 0,
        vat_rate: 0,
        vat_type: "NONE",
        paid_amount: 0,
        payment_status: paymentStatus,
        notes: remark || null,
        is_voided: false,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (docError || !document?.id) {
      return {
        success: false,
        error: docError?.message ?? "สร้างเอกสารปรับปรุงสต็อกไม่สำเร็จ",
      };
    }

    documentId = String(document.id);

    const itemPayload = stockLines.map((line, index) => {
      const product = productMap.get(line.product_id)!;
      const qty =
        docType === "STK_OB" ? Math.abs(line.qty) : line.qty;
      const unitCost =
        docType === "STK_OB"
          ? roundCost(Number(line.unit_cost_price ?? 0))
          : line.qty > 0 && line.unit_cost_price != null
            ? roundCost(Number(line.unit_cost_price))
            : roundCost(Number(product.cost_price ?? 0));

      return {
        document_id: documentId!,
        product_id: line.product_id,
        description: product.name ?? product.sku ?? "สินค้า",
        qty,
        uom_used: "ชิ้น",
        unit_price: 0,
        unit_cost_price: unitCost,
        discount_amount: 0,
        line_total: roundMoney(Math.abs(qty) * unitCost),
        sort_order: index + 1,
      };
    });

    const { error: itemsError } = await supabase
      .from("document_items")
      .insert(itemPayload);

    if (itemsError) {
      await supabase.from("documents").delete().eq("id", documentId);
      return {
        success: false,
        error: itemsError.message ?? "บันทึกรายการสินค้าไม่สำเร็จ",
      };
    }

    const ledgerPayload = stockLines.map((line) => {
      const product = productMap.get(line.product_id)!;
      const absQty = Math.abs(Math.trunc(line.qty));
      const unitCost =
        docType === "STK_OB"
          ? roundCost(Number(line.unit_cost_price ?? 0))
          : line.qty > 0 && line.unit_cost_price != null
            ? roundCost(Number(line.unit_cost_price))
            : roundCost(Number(product.cost_price ?? 0));

      if (docType === "STK_OB") {
        return {
          product_id: line.product_id,
          doc_header_id: null as string | null,
          trans_type: "IN",
          qty: absQty,
          notes: `${docType} ${docNo} | document_id=${documentId} | unit_cost=${unitCost.toFixed(4)}${remark ? ` | ${remark}` : ""}`,
        };
      }

      const transType = line.qty > 0 ? "IN" : "OUT";
      return {
        product_id: line.product_id,
        doc_header_id: null as string | null,
        trans_type: transType,
        qty: absQty,
        notes: `${docType} ${docNo} | document_id=${documentId} | adj=${line.qty > 0 ? "+" : "-"}${absQty} | ${remark}`,
      };
    });

    const { error: ledgerError } = await supabase
      .from("inventory_ledger")
      .insert(ledgerPayload);

    if (ledgerError) {
      await supabase.from("document_items").delete().eq("document_id", documentId);
      await supabase.from("documents").delete().eq("id", documentId);
      return {
        success: false,
        error:
          ledgerError.message ??
          "บันทึก inventory_ledger ไม่สำเร็จ — ยกเลิกเอกสารแล้ว",
      };
    }

    const costUpdates = new Map<string, number>();
    for (const line of stockLines) {
      if (docType === "STK_OB") {
        costUpdates.set(
          line.product_id,
          roundCost(Number(line.unit_cost_price ?? 0)),
        );
        continue;
      }
      if (line.qty > 0 && line.unit_cost_price != null) {
        costUpdates.set(line.product_id, roundCost(Number(line.unit_cost_price)));
      }
    }

    for (const [productId, cost] of costUpdates.entries()) {
      const { error: costError } = await supabase
        .from("products")
        .update({ cost_price: cost })
        .eq("id", productId);

      if (costError) {
        await supabase
          .from("inventory_ledger")
          .delete()
          .filter("notes", "ilike", `%document_id=${documentId}%`);
        await supabase.from("document_items").delete().eq("document_id", documentId);
        await supabase.from("documents").delete().eq("id", documentId);
        return {
          success: false,
          error:
            costError.message ??
            "อัปเดต products.cost_price ไม่สำเร็จ — ยกเลิกเอกสารแล้ว",
        };
      }
    }

    // ── Audit Log (fire-and-forget — never block the critical path) ──
    void logAuditTrail("documents", documentId, "INSERT", null, {
      doc_no: docNo,
      doc_type: docType,
      status: issuedStatus,
      doc_date: docDate,
      remark: remark || null,
      line_count: stockLines.length,
      audit_event: "ISSUE",
    }).catch((auditErr) => {
      console.error("[adjustInventory] audit log failed:", auditErr);
    });

    revalidatePath("/inventory/adjustments");
    revalidatePath("/inventory/ledger");

    return {
      success: true,
      document_id: documentId,
      doc_no: docNo,
      error: null,
    };
  } catch (err) {
    if (documentId) {
      await supabase
        .from("inventory_ledger")
        .delete()
        .filter("notes", "ilike", `%document_id=${documentId}%`);
      await supabase.from("document_items").delete().eq("document_id", documentId);
      await supabase.from("documents").delete().eq("id", documentId);
    }
    const message =
      err instanceof Error ? err.message : "บันทึกปรับปรุงสต็อกไม่สำเร็จ";
    return { success: false, error: message };
  }
}

/* -------------------------------------------------------------------------- */
/* getAdjustmentDetail                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Read-only detail for a single STK_OB / STK_ADJ document.
 * Joins document_items → products for SKU / color / size display.
 */
export async function getAdjustmentDetail(
  documentId: string,
): Promise<GetAdjustmentDetailResult> {
  const trimmed = documentId?.trim() ?? "";
  if (!trimmed) {
    return { data: null, error: "ไม่มี document_id" };
  }

  try {
    const supabase = createClient();

    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        status,
        doc_date,
        notes,
        created_at,
        document_items!document_items_document_id_fkey (
          id,
          product_id,
          description,
          qty,
          unit_cost_price,
          line_total,
          sort_order,
          products!document_items_product_id_fkey (
            id,
            sku,
            name,
            color,
            size
          )
        )
      `,
      )
      .eq("id", trimmed)
      .in("doc_type", [...INVENTORY_DOC_TYPES])
      .maybeSingle();

    if (docError) {
      return { data: null, error: docError.message };
    }
    if (!doc) {
      return { data: null, error: "ไม่พบเอกสารปรับปรุงสต็อก" };
    }

    type RawProduct = {
      id?: string;
      sku?: string;
      name?: string;
      color?: string | null;
      size?: string | null;
    };

    type RawItem = {
      id: string;
      product_id: string;
      description: string | null;
      qty: number | string;
      unit_cost_price: number | string | null;
      line_total: number | string | null;
      sort_order: number | string | null;
      products: RawProduct | RawProduct[] | null;
    };

    const rawItems: RawItem[] = Array.isArray(doc.document_items)
      ? (doc.document_items as RawItem[])
      : doc.document_items
        ? [doc.document_items as RawItem]
        : [];

    const items: AdjustmentDetailItem[] = rawItems
      .map((item) => {
        const product = Array.isArray(item.products)
          ? item.products[0]
          : item.products;
        return {
          id: item.id,
          product_id: item.product_id,
          sku: String(product?.sku ?? ""),
          product_name:
            String(product?.name ?? item.description ?? "").trim() || "—",
          color: product?.color ?? null,
          size: product?.size ?? null,
          qty: Math.trunc(Number(item.qty ?? 0)),
          unit_cost_price: roundCost(Number(item.unit_cost_price ?? 0)),
          line_total: roundMoney(Number(item.line_total ?? 0)),
          sort_order: Number(item.sort_order ?? 0),
        };
      })
      .sort((a, b) => a.sort_order - b.sort_order);

    const detail: AdjustmentDetail = {
      id: doc.id,
      doc_no: doc.doc_no,
      doc_type: doc.doc_type as AdjustmentDetail["doc_type"],
      status: doc.status,
      doc_date: doc.doc_date,
      remark: doc.notes ?? null,
      created_at: doc.created_at,
      items,
    };

    return { data: detail, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงรายละเอียดเอกสารไม่สำเร็จ";
    return { data: null, error: message };
  }
}
