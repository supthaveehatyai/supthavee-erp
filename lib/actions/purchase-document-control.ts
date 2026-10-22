"use server";

import { revalidatePath } from "next/cache";
import { getDocumentByNo, voidDocumentAction } from "@/lib/actions/document-actions";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { isAdminRoleCode } from "@/lib/auth/module-access";
import { GOODS_RECEIPT_DOC_TYPES, type GoodsReceiptDocType } from "@/lib/constants/document";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import type {
  PurchaseCloneDraft,
  PurchaseControlActionResult,
} from "@/types/purchase-document-control";
import type { Json } from "@/src/types/supabase";
import {
  isPurchaseVatReviseMode,
  previewPurchaseVatRevision,
  purchaseVatReviseModeToDocumentVat,
  type PurchaseVatReviseMode,
} from "@/lib/utils/purchase-vat-revise";

function isMissingReviseRpc(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const message = error.message ?? "";
  return (
    error.code === "PGRST202" ||
    /admin_revise_purchase_vat_mode|does not exist|could not find the function|schema cache/i.test(
      message,
    )
  );
}

async function requireActor() {
  const actor = await getCurrentAuthUser();
  if (!actor?.userId) return { ok: false as const, error: "กรุณาเข้าสู่ระบบ" };
  return { ok: true as const, actor, isAdmin: isAdminRoleCode(actor.roleCode) };
}

export async function revisePurchaseVatMode(input: {
  docNo: string;
  mode: PurchaseVatReviseMode;
  reason: string;
}): Promise<PurchaseControlActionResult> {
  try {
    const actor = await requireActor();
    if (!actor.ok) return { success: false, error: actor.error };
    if (!actor.isAdmin) {
      return { success: false, error: "เฉพาะผู้ดูแลระบบ (Admin) แก้ไขประเภทภาษีได้" };
    }

    const docNo = input.docNo?.trim() ?? "";
    const reason = input.reason?.trim() ?? "";
    const mode = String(input.mode ?? "").trim();
    if (!docNo) return { success: false, error: "ไม่พบเลขที่เอกสาร" };
    if (!isPurchaseVatReviseMode(mode)) {
      return { success: false, error: "ประเภทภาษีไม่ถูกต้อง" };
    }
    if (!reason) {
      return { success: false, error: "กรุณาระบุเหตุผลการแก้ไข" };
    }

    const supabase = createSupabaseAdmin();
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select(
        "id, doc_no, doc_type, status, payment_status, paid_amount, vat_type, vat_amount, net_before_vat, grand_total, sub_total, freight_cost, freight_tax_mode",
      )
      .eq("doc_no", docNo)
      .maybeSingle();

    if (docError) return { success: false, error: docError.message };
    if (!doc) return { success: false, error: "ไม่พบเอกสาร" };
    if (String(doc.status) !== "ISSUED" || String(doc.payment_status) !== "UNPAID") {
      return { success: false, error: "แก้ประเภทภาษีได้เฉพาะเอกสาร ISSUED และ UNPAID" };
    }
    if (Number(doc.paid_amount ?? 0) > 0) {
      return { success: false, error: "เอกสารมียอดชำระแล้ว" };
    }
    if (!(GOODS_RECEIPT_DOC_TYPES as readonly string[]).includes(String(doc.doc_type))) {
      return { success: false, error: "แก้ประเภทภาษีได้เฉพาะเอกสารรับสินค้า" };
    }

    const { data: itemRows, error: itemError } = await supabase
      .from("document_items")
      .select("line_total")
      .eq("document_id", doc.id);
    if (itemError) return { success: false, error: itemError.message };

    const goodsNet = (itemRows ?? []).reduce(
      (sum, row) => sum + Number(row.line_total ?? 0),
      0,
    );
    const nextFigures = previewPurchaseVatRevision({
      goodsNet,
      originFreight: Number(doc.freight_cost ?? 0),
      freightTaxMode:
        "freight_tax_mode" in doc ? String(doc.freight_tax_mode ?? "") : null,
      mode,
    });
    const nextVatType = purchaseVatReviseModeToDocumentVat(mode);

    const rpcClient = supabase as unknown as {
      rpc: (
        fn: "admin_revise_purchase_vat_mode",
        args: { p_doc_no: string; p_new_vat_mode: string; p_reason: string },
      ) => Promise<{ error: { code?: string; message?: string } | null }>;
    };
    const { error: rpcError } = await rpcClient.rpc("admin_revise_purchase_vat_mode", {
      p_doc_no: docNo,
      p_new_vat_mode: mode,
      p_reason: reason,
    });

    if (rpcError && !isMissingReviseRpc(rpcError)) {
      return { success: false, error: rpcError.message ?? "แก้ไขประเภทภาษีไม่สำเร็จ" };
    }

    if (rpcError && isMissingReviseRpc(rpcError)) {
      const { error: updateError } = await supabase
        .from("documents")
        .update({
          vat_type: nextVatType,
          vat_rate: nextFigures.vatRate,
          vat_amount: nextFigures.vatAmount,
          tax_rate: nextFigures.vatRate,
          tax_amount: nextFigures.vatAmount,
          net_before_vat: nextFigures.preVatAmount,
          grand_total: nextFigures.grandTotal,
          total_amount:
            nextVatType === "INCLUSIVE" ? nextFigures.grandTotal : nextFigures.preVatAmount,
          updated_at: new Date().toISOString(),
        })
        .eq("id", doc.id)
        .eq("status", "ISSUED");
      if (updateError) return { success: false, error: updateError.message };

      await supabase
        .from("doc_headers")
        .update({
          tax_rate: nextFigures.vatRate,
          tax_amount: nextFigures.vatAmount,
          grand_total: nextFigures.grandTotal,
        })
        .eq("id", doc.id);
    }

    await supabase.from("approval_logs").insert({
      action: "ADMIN_REVISE_VAT",
      actor_id: actor.actor.userId,
      document_id: doc.id,
      comments: `${reason} | ${String(doc.vat_type ?? "NONE")} -> ${mode}`,
    });
    await logAuditTrail(
      "documents",
      doc.id,
      "UPDATE",
      {
        vat_type: doc.vat_type,
        vat_amount: doc.vat_amount,
        net_before_vat: doc.net_before_vat,
        grand_total: doc.grand_total,
      },
      {
        vat_type: nextVatType,
        vat_mode: mode,
        reason,
        ...nextFigures,
      },
    );

    revalidatePath("/purchases");
    revalidatePath(`/purchases/${encodeURIComponent(docNo)}`);
    return { success: true, error: null, docNo };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "แก้ไขประเภทภาษีไม่สำเร็จ";
    return { success: false, error: message };
  }
}

export async function voidAndClonePurchaseDocument(input: {
  documentId: string;
  docNo: string;
  reason: string;
}): Promise<PurchaseControlActionResult> {
  try {
    const actor = await requireActor();
    if (!actor.ok) return { success: false, error: actor.error };
    if (!actor.isAdmin) {
      return { success: false, error: "เฉพาะผู้ดูแลระบบ (Admin) ยกเลิกและคัดลอกเอกสารได้" };
    }
    const reason = input.reason?.trim() ?? "";
    if (!reason) return { success: false, error: "กรุณาระบุเหตุผลการยกเลิก" };

    const supabase = createSupabaseAdmin();
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, doc_type, status, payment_status, paid_amount")
      .eq("id", input.documentId)
      .maybeSingle();
    if (docError) return { success: false, error: docError.message };
    if (!doc) return { success: false, error: "ไม่พบเอกสาร" };
    if (String(doc.status) !== "ISSUED" || String(doc.payment_status) !== "UNPAID") {
      return { success: false, error: "คัดลอกใหม่ได้เฉพาะเอกสาร ISSUED และ UNPAID" };
    }
    if (Number(doc.paid_amount ?? 0) > 0) {
      return { success: false, error: "เอกสารมียอดชำระแล้ว" };
    }
    if (!(GOODS_RECEIPT_DOC_TYPES as readonly string[]).includes(String(doc.doc_type))) {
      return { success: false, error: "คัดลอกใหม่ได้เฉพาะเอกสารรับสินค้า" };
    }

    const voided = await voidDocumentAction({
      documentId: input.documentId,
      voidReason: reason,
    });
    if (voided.error || !voided.data) {
      return { success: false, error: voided.error ?? "ยกเลิกเอกสารไม่สำเร็จ" };
    }

    await logAuditTrail("documents", input.documentId, "UPDATE", null, {
      status: "VOID",
      reason,
      clone: true,
    });

    return { success: true, error: null, docNo: voided.data.document_no || input.docNo };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ยกเลิกและคัดลอกเอกสารไม่สำเร็จ";
    return { success: false, error: message };
  }
}

export async function requestPurchaseDocumentControl(input: {
  documentId: string;
  docNo: string;
  reason: string;
}): Promise<PurchaseControlActionResult> {
  try {
    const actor = await requireActor();
    if (!actor.ok) return { success: false, error: actor.error };
    if (actor.isAdmin) {
      return { success: false, error: "ผู้ดูแลระบบแก้ไขเอกสารได้โดยตรง" };
    }
    const reason = input.reason?.trim() ?? "";
    const documentId = input.documentId?.trim() ?? "";
    const docNo = input.docNo?.trim() ?? "";
    if (!documentId || !docNo) return { success: false, error: "ไม่พบเอกสาร" };
    if (!reason) return { success: false, error: "กรุณาระบุเหตุผลคำขอ" };

    const supabase = createSupabaseAdmin();
    const { data: doc, error: docError } = await supabase
      .from("documents")
      .select("id, doc_no, doc_type, status, payment_status, vat_type, grand_total")
      .eq("id", documentId)
      .maybeSingle();
    if (docError) return { success: false, error: docError.message };
    if (!doc || String(doc.status) !== "ISSUED" || String(doc.payment_status) !== "UNPAID") {
      return { success: false, error: "ส่งคำขอได้เฉพาะเอกสาร ISSUED และ UNPAID" };
    }

    const newValue: Json = {
      kind: "purchase_document_control",
      document_id: doc.id,
      doc_no: doc.doc_no,
      doc_type: doc.doc_type,
      request: "ขออนุมัติแก้ไข/ยกเลิกเอกสาร",
      reason,
    };
    const { error: requestError } = await supabase.from("parameter_change_requests").insert({
      status: "PENDING",
      change_reason: reason,
      requested_by: actor.actor.userId,
      old_value: {
        doc_no: doc.doc_no,
        vat_type: doc.vat_type,
        grand_total: doc.grand_total,
        status: doc.status,
      },
      new_value: newValue,
    });

    const { error: logError } = await supabase.from("approval_logs").insert({
      action: "REQUEST_PURCHASE_CONTROL",
      actor_id: actor.actor.userId,
      document_id: doc.id,
      comments: reason,
    });
    if (logError) return { success: false, error: logError.message };
    if (requestError) {
      return {
        success: false,
        error: `บันทึกประวัติแล้ว แต่ส่งเข้าศูนย์อนุมัติไม่สำเร็จ: ${requestError.message}`,
      };
    }

    revalidatePath("/approvals");
    return { success: true, error: null, docNo };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "ส่งคำขอไม่สำเร็จ";
    return { success: false, error: message };
  }
}

export async function loadVoidedPurchaseClone(docNo: string): Promise<{
  data: PurchaseCloneDraft | null;
  error: string | null;
}> {
  try {
    const trimmed = decodeURIComponent(docNo?.trim() ?? "");
    if (!trimmed) return { data: null, error: null };
    const loaded = await getDocumentByNo(trimmed);
    if (loaded.error || !loaded.data) return { data: null, error: loaded.error };
    const doc = loaded.data;
    if (doc.status !== "VOID") return { data: null, error: null };
    if (!(GOODS_RECEIPT_DOC_TYPES as readonly string[]).includes(doc.doc_type)) {
      return { data: null, error: null };
    }
    const docType = doc.doc_type as GoodsReceiptDocType;
    return {
      data: {
        sourceDocNo: doc.doc_no,
        vendorId: doc.contact_id,
        docDate: doc.doc_date,
        documentRef: doc.reference_no?.trim() || "",
        docType,
        vatType:
          doc.vat_type === "INCLUSIVE" || doc.vat_type === "EXCLUSIVE" || doc.vat_type === "NONE"
            ? doc.vat_type
            : "NONE",
        discountText: doc.discount_text?.trim() || "",
        freightCost: Number(doc.freight_cost ?? 0),
        freightTaxMode: doc.freight_tax_mode?.trim() || "INCLUDED_IN_TAX",
        destFreightCost: Number(doc.dest_freight_cost ?? 0),
        billUrls: doc.bill_attachment_urls ?? [],
        lines: doc.items
          .filter((item) => item.product_id)
          .map((item) => ({
            key: item.id,
            product_id: item.product_id as string,
            sku: item.sku ?? "",
            name: item.description?.trim() || item.product_name?.trim() || item.sku || "สินค้า",
            qty: Number(item.qty) || 0,
            unit_cost: Number(item.unit_price) || 0,
            purchaseUomCode: item.uom_used?.trim() || "PCS",
            conversionFactor: String(item.uom_used ?? "").toUpperCase() === "DZN" ? 12 : 1,
            isFoc: Number(item.line_total) === 0 && Number(item.qty) > 0,
            vendorSku: "",
          })),
      },
      error: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "โหลดเอกสารสำหรับคัดลอกไม่สำเร็จ";
    return { data: null, error: message };
  }
}
