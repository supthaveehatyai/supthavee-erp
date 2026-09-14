"use server";

/**
 * AR Write-off — ใบสำคัญตัดหนี้สูญลูกหนี้การค้า (INV_DO / TAX_INV / CS_TAX).
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient()`.
 *
 * Schema mapping (do not invent columns):
 * - Header → `documents` (`doc_type` = AR_WRITEOFF)
 * - Lines  → `document_allocations`
 *     receipt_doc_id  = ใบ AR_WRITEOFF (DRAFT)
 *     invoice_doc_id  = บิลขายต้นทาง
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncBillingNotesAfterInvoicePayment } from "@/lib/actions/finance/billing-note-status";
import {
  approvalStatusFields,
  isPendingApprovalStatus,
} from "@/lib/approval/approval-rules";
import { revalidateApprovalCenterIfPending } from "@/lib/approval/revalidate-approval";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { AR_WRITEOFF_SOURCE_DOC_TYPES } from "@/lib/constants/document";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { generateDraftDocumentNo } from "@/lib/utils/draft-document-no";
import { todayIsoDate } from "@/lib/utils/outstanding-summary";
import { roundMoney } from "@/lib/utils/payment-fifo";
import { createArWriteoffSchema } from "@/lib/validations/ar-writeoff";
import type { CreateArWriteoffResult } from "@/types/ar-writeoff";

const MONEY_EPS = 0.02;
const WRITEOFF_DOC_TYPE = "AR_WRITEOFF" as const;
const WRITEOFF_ADJUSTMENT_REASON = "AR_WRITEOFF";
const ALLOWED_INVOICE_TYPES = new Set<string>(AR_WRITEOFF_SOURCE_DOC_TYPES);
const OPEN_PAYMENT_STATUSES = new Set(["UNPAID", "PARTIAL", "Pending"]);

type InvoiceSnapshot = {
  id: string;
  doc_no: string;
  doc_type: string;
  status: string;
  payment_status: string;
  grand_total: number;
  paid_amount: number;
  contact_id: string | null;
  is_voided: boolean | null;
};

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function firstZodMessage(error: {
  issues: Array<{ message: string }>;
}): string {
  return error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
}

function resolvePaymentStatus(
  grandTotal: number,
  newPaidAmount: number,
): "UNPAID" | "PARTIAL" | "PAID" {
  if (newPaidAmount <= MONEY_EPS) return "UNPAID";
  if (newPaidAmount >= roundMoney(grandTotal) - MONEY_EPS) return "PAID";
  return "PARTIAL";
}

function resolveSettledDocumentStatus(
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID",
): "ISSUED" | "PAID" {
  return paymentStatus === "PAID" ? "PAID" : "ISSUED";
}

async function rollbackWriteoff(
  supabase: SupabaseClient,
  writeoffId: string,
  revertedInvoices: Array<{
    id: string;
    paid_amount: number;
    payment_status: string;
    status: string;
  }>,
): Promise<void> {
  const nowIso = new Date().toISOString();
  for (const invoice of revertedInvoices) {
    await supabase
      .from("documents")
      .update({
        paid_amount: invoice.paid_amount,
        payment_status: invoice.payment_status,
        status: invoice.status,
        updated_at: nowIso,
      })
      .eq("id", invoice.id);
  }
  await supabase
    .from("document_allocations")
    .delete()
    .eq("receipt_doc_id", writeoffId);
  await supabase.from("documents").delete().eq("id", writeoffId);
}

/**
 * บันทึกใบสำคัญตัดหนี้สูญ (AR_WRITEOFF) แบบ Late Numbering (DRAFT)
 * และตัดยอดบิลขายปลายทางผ่าน `document_allocations`
 */
export async function createWriteOff(
  payload: unknown,
): Promise<CreateArWriteoffResult> {
  const parsed = createArWriteoffSchema.safeParse(payload);
  if (!parsed.success) {
    return { success: false, error: firstZodMessage(parsed.error) };
  }

  const contactId = parsed.data.contact_id;
  const remark = parsed.data.remark;
  const allocatedItems = parsed.data.allocated_items.map((item) => ({
    document_id: item.document_id,
    writeoff_amount: roundMoney(item.writeoff_amount),
  }));

  const uniqueIds = new Set(allocatedItems.map((item) => item.document_id));
  if (uniqueIds.size !== allocatedItems.length) {
    return {
      success: false,
      error: "ห้ามเลือกบิลขายซ้ำในรายการตัดหนี้สูญ",
    };
  }

  const owner = await requireSessionUserId();
  if (!owner.ok) {
    return { success: false, error: owner.error };
  }

  const supabaseAdmin = createSupabaseServerClient();
  const docDate = todayIsoDate();
  let writeoffId: string | null = null;
  const updatedInvoices: Array<{
    id: string;
    paid_amount: number;
    payment_status: string;
    status: string;
  }> = [];

  try {
    const { data: periodClosed, error: periodError } = await supabaseAdmin.rpc(
      "is_period_closed",
      { doc_date: docDate },
    );
    if (periodError) {
      return { success: false, error: periodError.message };
    }
    if (periodClosed === true) {
      return {
        success: false,
        error: "งวดบัญชีของวันที่เอกสารนี้ถูกปิดแล้ว ไม่สามารถตัดหนี้สูญได้",
      };
    }

    const { data: contact, error: contactError } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .maybeSingle();

    if (contactError) {
      return { success: false, error: contactError.message };
    }
    if (!contact) {
      return { success: false, error: "ไม่พบข้อมูลลูกค้า" };
    }

    const invoiceIds = allocatedItems.map((item) => item.document_id);
    const { data: invoiceRows, error: invoiceError } = await supabaseAdmin
      .from("documents")
      .select(
        "id, doc_no, doc_type, status, payment_status, grand_total, paid_amount, contact_id, is_voided",
      )
      .in("id", invoiceIds);

    if (invoiceError) {
      return { success: false, error: invoiceError.message };
    }

    const invoiceMap = new Map<string, InvoiceSnapshot>();
    for (const row of invoiceRows ?? []) {
      invoiceMap.set(String(row.id), {
        id: String(row.id),
        doc_no: String(row.doc_no ?? "").trim() || String(row.id),
        doc_type: String(row.doc_type ?? ""),
        status: String(row.status ?? ""),
        payment_status: String(row.payment_status ?? "UNPAID"),
        grand_total: roundMoney(toMoney(row.grand_total)),
        paid_amount: roundMoney(toMoney(row.paid_amount)),
        contact_id: row.contact_id ? String(row.contact_id) : null,
        is_voided: row.is_voided ?? false,
      });
    }

    for (const item of allocatedItems) {
      const invoice = invoiceMap.get(item.document_id);
      if (!invoice) {
        return {
          success: false,
          error: "ไม่พบบิลขายในรายการตัดหนี้สูญ",
        };
      }
      if (invoice.contact_id !== contactId) {
        return {
          success: false,
          error: `บิล ${invoice.doc_no} ไม่ได้อยู่ภายใต้ลูกค้าที่เลือก`,
        };
      }
      if (invoice.is_voided === true || invoice.status === "VOID") {
        return {
          success: false,
          error: `บิล ${invoice.doc_no} ถูกยกเลิกแล้ว ไม่สามารถตัดหนี้สูญได้`,
        };
      }
      if (!ALLOWED_INVOICE_TYPES.has(invoice.doc_type)) {
        return {
          success: false,
          error: `บิล ${invoice.doc_no} ไม่ใช่ใบแจ้งหนี้ขาย (INV_DO / TAX_INV / CS_TAX)`,
        };
      }
      if (invoice.status !== "ISSUED") {
        return {
          success: false,
          error: `บิล ${invoice.doc_no} ต้องเป็นสถานะ ISSUED จึงจะตัดหนี้สูญได้`,
        };
      }
      if (!OPEN_PAYMENT_STATUSES.has(invoice.payment_status)) {
        return {
          success: false,
          error: `บิล ${invoice.doc_no} ไม่มียอดหนี้คงเหลือ`,
        };
      }

      const remaining = roundMoney(
        Math.max(0, invoice.grand_total - invoice.paid_amount),
      );
      if (remaining <= MONEY_EPS) {
        return {
          success: false,
          error: `บิล ${invoice.doc_no} ไม่มียอดหนี้คงเหลือ`,
        };
      }
      if (item.writeoff_amount > remaining + MONEY_EPS) {
        return {
          success: false,
          error: `บิล ${invoice.doc_no}: ยอดตัดหนี้สูญ (${item.writeoff_amount.toFixed(2)}) เกินยอดคงเหลือ (${remaining.toFixed(2)})`,
        };
      }
    }

    const grandTotal = roundMoney(
      allocatedItems.reduce((sum, item) => sum + item.writeoff_amount, 0),
    );
    if (grandTotal <= MONEY_EPS) {
      return { success: false, error: "ยอดรวมตัดหนี้สูญต้องมากกว่า 0" };
    }

    const documentNo = generateDraftDocumentNo();
    const nowIso = new Date().toISOString();
    const approval = approvalStatusFields(WRITEOFF_DOC_TYPE);
    const pendingApproval = isPendingApprovalStatus(approval.approval_status);
    const firstInvoiceId = allocatedItems[0]?.document_id ?? null;

    const { data: writeoffDoc, error: insertError } = await supabaseAdmin
      .from("documents")
      .insert({
        doc_no: documentNo,
        doc_type: WRITEOFF_DOC_TYPE,
        status: "DRAFT",
        doc_date: docDate,
        contact_id: contactId,
        ref_document_id: firstInvoiceId,
        sub_total: grandTotal,
        discount_amount: 0,
        tax_rate: 0,
        tax_amount: 0,
        vat_rate: 0,
        vat_amount: 0,
        vat_type: "NONE",
        net_before_vat: grandTotal,
        total_amount: grandTotal,
        grand_total: grandTotal,
        paid_amount: 0,
        payment_status: "UNPAID",
        remark,
        notes: "ใบสำคัญตัดหนี้สูญ (AR Write-off)",
        created_by: owner.userId,
        approval_status: approval.approval_status,
        approved_by: approval.approved_by,
        approved_at: approval.approved_at,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (insertError || !writeoffDoc?.id) {
      return {
        success: false,
        error: insertError?.message ?? "บันทึกใบสำคัญตัดหนี้สูญไม่สำเร็จ",
      };
    }

    writeoffId = String(writeoffDoc.id);
    const writeoffDocNo = String(writeoffDoc.doc_no ?? documentNo);

    const allocationRows = allocatedItems.map((item) => ({
      receipt_doc_id: writeoffId as string,
      invoice_doc_id: item.document_id,
      allocated_amount: item.writeoff_amount,
      wht_amount: 0,
      adjustment_amount: 0,
      adjustment_reason: WRITEOFF_ADJUSTMENT_REASON,
    }));

    const { error: allocError } = await supabaseAdmin
      .from("document_allocations")
      .insert(allocationRows);

    if (allocError) {
      await supabaseAdmin.from("documents").delete().eq("id", writeoffId);
      return {
        success: false,
        error: allocError.message ?? "บันทึก document_allocations ไม่สำเร็จ",
      };
    }

    const settledInvoiceIds: string[] = [];

    for (const item of allocatedItems) {
      const invoice = invoiceMap.get(item.document_id)!;
      const newPaid = roundMoney(invoice.paid_amount + item.writeoff_amount);
      const nextPaymentStatus = resolvePaymentStatus(
        invoice.grand_total,
        newPaid,
      );
      const nextDocStatus = resolveSettledDocumentStatus(nextPaymentStatus);

      const { error: updateError } = await supabaseAdmin
        .from("documents")
        .update({
          paid_amount: newPaid,
          payment_status: nextPaymentStatus,
          status: nextDocStatus,
          updated_at: nowIso,
        })
        .eq("id", invoice.id);

      if (updateError) {
        await rollbackWriteoff(supabaseAdmin, writeoffId, updatedInvoices);
        return {
          success: false,
          error: `อัปเดตสถานะบิล ${invoice.doc_no} ไม่สำเร็จ: ${updateError.message}`,
        };
      }

      updatedInvoices.push({
        id: invoice.id,
        paid_amount: invoice.paid_amount,
        payment_status: invoice.payment_status,
        status: invoice.status,
      });

      if (nextDocStatus === "PAID") {
        settledInvoiceIds.push(invoice.id);
      }

      const invoiceAudit = await logAuditTrail(
        "documents",
        invoice.id,
        "UPDATE",
        {
          id: invoice.id,
          doc_no: invoice.doc_no,
          doc_type: invoice.doc_type,
          status: invoice.status,
          payment_status: invoice.payment_status,
          paid_amount: invoice.paid_amount,
        },
        {
          audit_event: "AR_WRITEOFF",
          id: invoice.id,
          doc_no: invoice.doc_no,
          doc_type: invoice.doc_type,
          status: nextDocStatus,
          payment_status: nextPaymentStatus,
          paid_amount: newPaid,
          writeoff_amount: item.writeoff_amount,
          writeoff_doc_no: writeoffDocNo,
        },
      );
      if (!invoiceAudit.success) {
        console.error(
          "[createWriteoff][audit invoice]",
          invoiceAudit.error,
        );
      }
    }

    if (updatedInvoices.length > 0) {
      const bnSync = await syncBillingNotesAfterInvoicePayment(
        supabaseAdmin,
        updatedInvoices.map((row) => row.id),
      );
      if (bnSync.error) {
        console.error("[createWriteoff][sync BN]", bnSync.error);
      }
    }

    const writeoffAudit = await logAuditTrail(
      "documents",
      writeoffId,
      "INSERT",
      null,
      {
        audit_event: "AR_WRITEOFF",
        id: writeoffId,
        doc_no: writeoffDocNo,
        doc_type: WRITEOFF_DOC_TYPE,
        status: "DRAFT",
        contact_id: contactId,
        grand_total: grandTotal,
        remark,
        invoice_count: allocatedItems.length,
        settled_invoice_ids: settledInvoiceIds,
        summary: `สร้างใบสำคัญตัดหนี้สูญ ${writeoffDocNo} จำนวน ${grandTotal.toFixed(2)} บาท`,
      },
    );
    if (!writeoffAudit.success) {
      console.error("[createWriteoff][audit header]", writeoffAudit.error);
    }

    revalidatePath("/sales");
    revalidatePath("/finance/ar-writeoff");
    revalidatePath("/finance/ap-ar");
    revalidatePath("/finance/payments");
    revalidateApprovalCenterIfPending(pendingApproval);

    return {
      success: true,
      error: null,
      document_id: writeoffId,
      document_no: writeoffDocNo,
      grand_total: grandTotal,
      settled_invoice_ids: settledInvoiceIds,
      pending_approval: pendingApproval,
    };
  } catch (err) {
    if (writeoffId) {
      await rollbackWriteoff(supabaseAdmin, writeoffId, updatedInvoices);
    }
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "บันทึกใบสำคัญตัดหนี้สูญไม่สำเร็จ",
    };
  }
}
