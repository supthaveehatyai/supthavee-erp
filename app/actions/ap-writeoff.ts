"use server";

/**
 * AP Write-off Server Actions — ตัดหนี้สูญ / ตัดเศษบัญชีเจ้าหนี้ (PWO).
 * Zero Client-Side Fetching: ใช้ `supabaseAdmin` (Service Role) เท่านั้น.
 *
 * Schema (ห้ามเดาคอลัมน์):
 * - `documents`          header (`doc_type` = AP_WRITEOFF)
 * - `document_allocations`  ตัดยอดบิลซื้อ (`receipt_doc_id` / `invoice_doc_id` / `allocated_amount`)
 * - `user_profiles`      ABAC `approval_limit`
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { syncBillingNotesAfterInvoicePayment } from "@/lib/actions/finance/billing-note-status";
import {
  exceedsApprovalLimit,
  requiresDocumentApproval,
} from "@/lib/approval/approval-rules";
import { revalidateApprovalCenterIfPending } from "@/lib/approval/revalidate-approval";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { AP_WRITEOFF_SOURCE_DOC_TYPES } from "@/lib/constants/document";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { generateDraftDocumentNo } from "@/lib/utils/draft-document-no";
import { todayIsoDate } from "@/lib/utils/outstanding-summary";
import { roundMoney } from "@/lib/utils/payment-fifo";
import { deleteDraftDocument } from "@/app/actions/documents";
import { voidDocumentAction } from "@/lib/actions/document-actions";
import { createApWriteoffSchema } from "@/lib/validations/ap-writeoff";
import type {
  ApWriteoffListItem,
  CreateAPWriteOffResult,
  GetOutstandingApResult,
  ListApWriteoffsResult,
  OutstandingApDocument,
} from "@/types/ap-writeoff";
import { resolveApWriteoffListStatus } from "@/types/ap-writeoff";
import type {
  DeleteDraftDocumentResult,
  VoidDocumentActionInput,
  VoidDocumentResult,
} from "@/types/document";
import type { GetDocumentPreviewResult } from "@/types/document-preview";

const MONEY_EPS = 0.02;
const WRITEOFF_DOC_TYPE = "AP_WRITEOFF";
const WRITEOFF_ADJUSTMENT_REASON = "AP_WRITEOFF";
const SOURCE_DOC_TYPES = [...AP_WRITEOFF_SOURCE_DOC_TYPES];

type ContactJoin = {
  id?: string;
  company_name?: string | null;
};

type ApDocRow = {
  id: string;
  doc_no: string | null;
  doc_type: string | null;
  doc_date: string | null;
  status: string | null;
  payment_status: string | null;
  contact_id: string | null;
  grand_total: number | string | null;
  paid_amount: number | string | null;
  is_voided: boolean | null;
  contacts: ContactJoin | ContactJoin[] | null;
};

type InvoiceSnapshot = {
  id: string;
  doc_no: string;
  doc_type: string;
  status: string;
  payment_status: string;
  grand_total: number;
  paid_amount: number;
  allocated_amount: number;
  remaining_balance: number;
  contact_id: string | null;
  is_voided: boolean | null;
};

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function unwrapContact(
  value: ContactJoin | ContactJoin[] | null,
): ContactJoin | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function firstZodMessage(error: {
  issues: Array<{ message: string }>;
}): string {
  return error.issues[0]?.message ?? "ข้อมูลไม่ถูกต้อง";
}

function resolveSettledPaymentStatus(
  remainingAfter: number,
): "UNPAID" | "PARTIAL" | "PAID" {
  if (remainingAfter <= MONEY_EPS) return "PAID";
  return "PARTIAL";
}

async function sumAllocatedByInvoice(
  supabaseAdmin: SupabaseClient,
  invoiceIds: string[],
): Promise<Map<string, number>> {
  const totals = new Map<string, number>();
  if (invoiceIds.length === 0) return totals;

  const { data, error } = await supabaseAdmin
    .from("document_allocations")
    .select("invoice_doc_id, allocated_amount")
    .in("invoice_doc_id", invoiceIds);

  if (error) {
    throw new Error(error.message);
  }

  for (const row of data ?? []) {
    const invoiceId = String(row.invoice_doc_id ?? "").trim();
    if (!invoiceId) continue;
    const next = roundMoney(
      (totals.get(invoiceId) ?? 0) + toMoney(row.allocated_amount),
    );
    totals.set(invoiceId, next);
  }

  return totals;
}

async function loadMakerApprovalLimit(
  supabaseAdmin: SupabaseClient,
  actorId: string,
): Promise<{ ok: true; approvalLimit: number } | { ok: false; error: string }> {
  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, approval_limit")
    .eq("id", actorId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message };
  }
  if (!profile) {
    return { ok: false, error: "ไม่พบโปรไฟล์ผู้ใช้งาน" };
  }

  const limit = Number(profile.approval_limit ?? 0);
  return {
    ok: true,
    approvalLimit: Number.isFinite(limit) && limit >= 0 ? limit : 0,
  };
}

async function rollbackWriteoff(
  supabaseAdmin: SupabaseClient,
  writeoffId: string,
  revertedInvoices: Array<{
    id: string;
    paid_amount: number;
    payment_status: string;
    status: string;
  }>,
): Promise<void> {
  const nowIso = new Date().toISOString();
  if (revertedInvoices.length > 0) {
    await Promise.all(
      revertedInvoices.map((invoice) =>
        supabaseAdmin
          .from("documents")
          .update({
            paid_amount: invoice.paid_amount,
            payment_status: invoice.payment_status,
            status: invoice.status,
            updated_at: nowIso,
          })
          .eq("id", invoice.id),
      ),
    );
  }
  await supabaseAdmin
    .from("document_allocations")
    .delete()
    .eq("receipt_doc_id", writeoffId);
  await supabaseAdmin.from("documents").delete().eq("id", writeoffId);
}

/**
 * บิลซื้อค้างชำระ (AP_INV / AP_TAX / AP_CASH) สถานะ ISSUED
 * ยอดคงเหลือ = `grand_total` − Σ `document_allocations.allocated_amount`
 */
export async function getOutstandingAP(): Promise<GetOutstandingApResult> {
  try {
    const supabaseAdmin = createSupabaseServerClient();

    const { data, error } = await supabaseAdmin
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        doc_date,
        status,
        payment_status,
        contact_id,
        grand_total,
        paid_amount,
        is_voided,
        contacts:contact_id (
          id,
          company_name
        )
      `,
      )
      .in("doc_type", SOURCE_DOC_TYPES)
      .eq("status", "ISSUED")
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    if (error) {
      return { success: false, data: [], error: error.message };
    }

    const rows = (data ?? []) as ApDocRow[];
    const invoiceIds = rows.map((row) => String(row.id));
    const allocatedMap = await sumAllocatedByInvoice(supabaseAdmin, invoiceIds);

    const outstanding: OutstandingApDocument[] = [];
    for (const row of rows) {
      if (row.is_voided === true) continue;
      const contact = unwrapContact(row.contacts);
      const contactId = row.contact_id?.trim() || contact?.id || "";
      if (!contactId) continue;

      const grandTotal = roundMoney(toMoney(row.grand_total));
      const allocatedAmount = roundMoney(
        allocatedMap.get(String(row.id)) ?? toMoney(row.paid_amount),
      );
      const remainingBalance = roundMoney(
        Math.max(0, grandTotal - allocatedAmount),
      );
      if (remainingBalance <= MONEY_EPS) continue;

      outstanding.push({
        id: String(row.id),
        doc_no: String(row.doc_no ?? "").trim() || String(row.id),
        doc_type: String(row.doc_type ?? ""),
        doc_date: row.doc_date ? String(row.doc_date) : "",
        status: String(row.status ?? "ISSUED"),
        payment_status: String(row.payment_status ?? "UNPAID"),
        contact_id: contactId,
        contact_name: contact?.company_name?.trim() || "ไม่ระบุชื่อผู้จำหน่าย",
        grand_total: grandTotal,
        allocated_amount: allocatedAmount,
        remaining_balance: remainingBalance,
      });
    }

    return { success: true, data: outstanding, error: null };
  } catch (err) {
    return {
      success: false,
      data: [],
      error:
        err instanceof Error
          ? err.message
          : "ดึงรายการเจ้าหนี้ค้างชำระไม่สำเร็จ",
    };
  }
}

/**
 * บันทึกใบสำคัญตัดหนี้สูญ (AP_WRITEOFF) แบบ Late Numbering (DRAFT)
 */
export async function createAPWriteOff(
  payload: unknown,
): Promise<CreateAPWriteOffResult> {
  const parsed = createApWriteoffSchema.safeParse(payload);
  if (!parsed.success) {
    return {
      success: false,
      data: null,
      error: firstZodMessage(parsed.error),
    };
  }

  const remark = parsed.data.remark.trim();
  if (!remark) {
    return {
      success: false,
      data: null,
      error: "กรุณาระบุเหตุผลการตัดหนี้สูญ",
    };
  }

  const contactId = parsed.data.contact_id;
  const allocatedItems = parsed.data.allocated_items.map((item) => ({
    document_id: item.document_id,
    writeoff_amount: roundMoney(item.writeoff_amount),
  }));

  const uniqueIds = new Set(allocatedItems.map((item) => item.document_id));
  if (uniqueIds.size !== allocatedItems.length) {
    return {
      success: false,
      data: null,
      error: "ห้ามเลือกบิลซื้อซ้ำในรายการตัดหนี้สูญ",
    };
  }

  const owner = await requireSessionUserId();
  if (!owner.ok) {
    return { success: false, data: null, error: owner.error };
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
      return { success: false, data: null, error: periodError.message };
    }
    if (periodClosed === true) {
      return {
        success: false,
        data: null,
        error: "งวดบัญชีของวันที่เอกสารนี้ถูกปิดแล้ว ไม่สามารถตัดหนี้สูญได้",
      };
    }

    const limitResult = await loadMakerApprovalLimit(
      supabaseAdmin,
      owner.userId,
    );
    if (!limitResult.ok) {
      return { success: false, data: null, error: limitResult.error };
    }

    const { data: contact, error: contactError } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("id", contactId)
      .maybeSingle();

    if (contactError) {
      return { success: false, data: null, error: contactError.message };
    }
    if (!contact) {
      return { success: false, data: null, error: "ไม่พบข้อมูลผู้จำหน่าย" };
    }

    const invoiceIds = allocatedItems.map((item) => item.document_id);
    const [{ data: invoiceRows, error: invoiceError }, allocatedMap] =
      await Promise.all([
        supabaseAdmin
          .from("documents")
          .select(
            "id, doc_no, doc_type, status, payment_status, grand_total, paid_amount, contact_id, is_voided",
          )
          .in("id", invoiceIds),
        sumAllocatedByInvoice(supabaseAdmin, invoiceIds),
      ]);

    if (invoiceError) {
      return { success: false, data: null, error: invoiceError.message };
    }

    const invoiceMap = new Map<string, InvoiceSnapshot>();
    for (const row of invoiceRows ?? []) {
      const grandTotal = roundMoney(toMoney(row.grand_total));
      const allocatedAmount = roundMoney(
        allocatedMap.get(String(row.id)) ?? toMoney(row.paid_amount),
      );
      invoiceMap.set(String(row.id), {
        id: String(row.id),
        doc_no: String(row.doc_no ?? "").trim() || String(row.id),
        doc_type: String(row.doc_type ?? ""),
        status: String(row.status ?? ""),
        payment_status: String(row.payment_status ?? "UNPAID"),
        grand_total: grandTotal,
        paid_amount: roundMoney(toMoney(row.paid_amount)),
        allocated_amount: allocatedAmount,
        remaining_balance: roundMoney(Math.max(0, grandTotal - allocatedAmount)),
        contact_id: row.contact_id ? String(row.contact_id) : null,
        is_voided: row.is_voided ?? false,
      });
    }

    for (const item of allocatedItems) {
      const invoice = invoiceMap.get(item.document_id);
      if (!invoice) {
        return {
          success: false,
          data: null,
          error: "ไม่พบบิลซื้อในรายการตัดหนี้สูญ",
        };
      }
      if (invoice.contact_id !== contactId) {
        return {
          success: false,
          data: null,
          error: `บิล ${invoice.doc_no} ไม่ได้อยู่ภายใต้ผู้จำหน่ายที่เลือก`,
        };
      }
      if (invoice.is_voided === true || invoice.status === "VOID") {
        return {
          success: false,
          data: null,
          error: `บิล ${invoice.doc_no} ถูกยกเลิกแล้ว ไม่สามารถตัดหนี้สูญได้`,
        };
      }
      if (
        !(SOURCE_DOC_TYPES as readonly string[]).includes(invoice.doc_type)
      ) {
        return {
          success: false,
          data: null,
          error: `บิล ${invoice.doc_no} ไม่ใช่ใบตั้งหนี้ซื้อ (AP_INV / AP_TAX / AP_CASH)`,
        };
      }
      if (invoice.status !== "ISSUED") {
        return {
          success: false,
          data: null,
          error: `บิล ${invoice.doc_no} ต้องเป็นสถานะ ISSUED จึงจะตัดหนี้สูญได้`,
        };
      }
      if (invoice.remaining_balance <= MONEY_EPS) {
        return {
          success: false,
          data: null,
          error: `บิล ${invoice.doc_no} ไม่มียอดหนี้คงเหลือ`,
        };
      }
      if (item.writeoff_amount > invoice.remaining_balance + MONEY_EPS) {
        return {
          success: false,
          data: null,
          error: `บิล ${invoice.doc_no}: ยอดตัดหนี้สูญ (${item.writeoff_amount.toFixed(2)}) เกินยอดคงเหลือ (${invoice.remaining_balance.toFixed(2)})`,
        };
      }
    }

    const grandTotal = roundMoney(
      allocatedItems.reduce((sum, item) => sum + item.writeoff_amount, 0),
    );
    if (grandTotal <= MONEY_EPS) {
      return {
        success: false,
        data: null,
        error: "ยอดรวมตัดหนี้สูญต้องมากกว่า 0",
      };
    }

    const exceedsLimit = exceedsApprovalLimit(
      grandTotal,
      limitResult.approvalLimit,
    );
    const pendingApproval =
      requiresDocumentApproval(WRITEOFF_DOC_TYPE) || exceedsLimit;

    const documentNo = generateDraftDocumentNo();
    const nowIso = new Date().toISOString();
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
        notes: "ใบสำคัญตัดหนี้สูญ (AP Write-off)",
        created_by: owner.userId,
        approval_status: pendingApproval ? "PENDING" : "APPROVED",
        approved_by: null,
        approved_at: null,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (insertError || !writeoffDoc?.id) {
      return {
        success: false,
        data: null,
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
        data: null,
        error: allocError.message ?? "บันทึก document_allocations ไม่สำเร็จ",
      };
    }

    const invoiceSnapshots = allocatedItems
      .map((item) => invoiceMap.get(item.document_id))
      .filter((invoice): invoice is InvoiceSnapshot => Boolean(invoice))
      .map((invoice) => ({
        id: invoice.id,
        paid_amount: invoice.paid_amount,
        payment_status: invoice.payment_status,
        status: invoice.status,
      }));
    updatedInvoices.push(...invoiceSnapshots);

    const updateResults = await Promise.all(
      allocatedItems.map(async (item) => {
        const invoice = invoiceMap.get(item.document_id);
        if (!invoice) {
          return { ok: false as const, error: "ไม่พบบิลซื้อ", invoice: null };
        }

        const remainingAfter = roundMoney(
          invoice.remaining_balance - item.writeoff_amount,
        );
        const fullySettled = remainingAfter <= MONEY_EPS;
        const nextPaymentStatus = resolveSettledPaymentStatus(remainingAfter);
        const nextDocStatus = fullySettled ? "PAID" : "ISSUED";
        const newPaid = roundMoney(invoice.grand_total - remainingAfter);

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
          return {
            ok: false as const,
            error: `อัปเดตสถานะบิล ${invoice.doc_no} ไม่สำเร็จ: ${updateError.message}`,
            invoice,
          };
        }

        return {
          ok: true as const,
          error: null,
          invoice,
          nextDocStatus,
          nextPaymentStatus,
          newPaid,
          writeoffAmount: item.writeoff_amount,
        };
      }),
    );

    const failedUpdate = updateResults.find((row) => !row.ok);
    if (failedUpdate) {
      await rollbackWriteoff(supabaseAdmin, writeoffId, invoiceSnapshots);
      return {
        success: false,
        data: null,
        error: failedUpdate.error ?? "อัปเดตสถานะบิลซื้อไม่สำเร็จ",
      };
    }

    const settledInvoiceIds: string[] = [];
    for (const row of updateResults) {
      if (!row.ok || !row.invoice) continue;
      if (row.nextDocStatus === "PAID") {
        settledInvoiceIds.push(row.invoice.id);
      }
    }

    await Promise.all(
      updateResults.map(async (row) => {
        if (!row.ok || !row.invoice) return;
        const invoiceAudit = await logAuditTrail(
          "documents",
          row.invoice.id,
          "UPDATE",
          {
            id: row.invoice.id,
            doc_no: row.invoice.doc_no,
            doc_type: row.invoice.doc_type,
            status: row.invoice.status,
            payment_status: row.invoice.payment_status,
            paid_amount: row.invoice.paid_amount,
          },
          {
            audit_event: "AP_WRITEOFF",
            id: row.invoice.id,
            doc_no: row.invoice.doc_no,
            doc_type: row.invoice.doc_type,
            status: row.nextDocStatus,
            payment_status: row.nextPaymentStatus,
            paid_amount: row.newPaid,
            writeoff_amount: row.writeoffAmount,
            writeoff_doc_no: writeoffDocNo,
          },
        );
        if (!invoiceAudit.success) {
          console.error(
            "[createAPWriteOff][audit invoice]",
            invoiceAudit.error,
          );
        }
      }),
    );

    if (updatedInvoices.length > 0) {
      const brSync = await syncBillingNotesAfterInvoicePayment(
        supabaseAdmin,
        updatedInvoices.map((row) => row.id),
      );
      if (brSync.error) {
        console.error("[createAPWriteOff][sync BR]", brSync.error);
      }
    }

    const writeoffAudit = await logAuditTrail(
      "documents",
      writeoffId,
      "INSERT",
      null,
      {
        audit_event: "AP_WRITEOFF",
        id: writeoffId,
        doc_no: writeoffDocNo,
        doc_type: WRITEOFF_DOC_TYPE,
        status: "DRAFT",
        contact_id: contactId,
        grand_total: grandTotal,
        remark,
        approval_limit: limitResult.approvalLimit,
        exceeds_approval_limit: exceedsLimit,
        invoice_count: allocatedItems.length,
        settled_invoice_ids: settledInvoiceIds,
        summary: `สร้างใบสำคัญตัดหนี้สูญ ${writeoffDocNo} จำนวน ${grandTotal.toFixed(2)} บาท`,
      },
    );
    if (!writeoffAudit.success) {
      console.error("[createAPWriteOff][audit header]", writeoffAudit.error);
    }

    revalidatePath("/purchases");
    revalidatePath("/finance/ap-writeoff");
    revalidatePath("/finance/ap-ar");
    revalidatePath("/finance/ap-payment");
    revalidateApprovalCenterIfPending(pendingApproval);

    return {
      success: true,
      data: {
        document_id: writeoffId,
        document_no: writeoffDocNo,
        grand_total: grandTotal,
        settled_invoice_ids: settledInvoiceIds,
        pending_approval: pendingApproval,
        approval_limit: limitResult.approvalLimit,
      },
      error: null,
    };
  } catch (err) {
    if (writeoffId) {
      await rollbackWriteoff(supabaseAdmin, writeoffId, updatedInvoices);
    }
    return {
      success: false,
      data: null,
      error:
        err instanceof Error
          ? err.message
          : "บันทึกใบสำคัญตัดหนี้สูญไม่สำเร็จ",
    };
  }
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LIST_PATH = "/finance/ap-writeoff";

type InvoiceDocJoin = {
  doc_no?: string | null;
  doc_type?: string | null;
};

type ProfileJoin = {
  id: string;
  full_name: string | null;
  email: string | null;
};

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function sanitizeIlikeQuery(raw: string): string {
  return raw.replace(/[%_\\]/g, "").trim();
}

function resolveCreatorName(profile: ProfileJoin | undefined): string {
  const fullName = profile?.full_name?.trim() || "";
  if (fullName) return fullName;
  const email = profile?.email?.trim() || "";
  if (email) return email;
  return "ระบบ";
}

/**
 * รายการใบสำคัญตัดหนี้สูญเจ้าหนี้ (`doc_type` = AP_WRITEOFF)
 * เรียงตาม `created_at` DESC — ตาราง `documents` ไม่มีคอลัมน์ `posting_date`
 * จึงใช้วันที่บันทึกเป็น Posting Date ตามมาตรฐานหน้า Expenses
 */
export async function listApWriteoffs(
  query?: string,
): Promise<ListApWriteoffsResult> {
  try {
    const supabaseAdmin = createSupabaseServerClient();
    const keyword = sanitizeIlikeQuery(query ?? "");

    let listQuery = supabaseAdmin
      .from("documents")
      .select(
        "id, doc_no, doc_date, created_at, created_by, grand_total, remark, status, approval_status",
      )
      .eq("doc_type", WRITEOFF_DOC_TYPE)
      .order("created_at", { ascending: false });

    if (keyword) {
      listQuery = listQuery.ilike("doc_no", `%${keyword}%`);
    }

    const { data, error } = await listQuery;
    if (error) {
      return { success: false, data: [], error: error.message };
    }

    const rows = data ?? [];
    const creatorIds = [
      ...new Set(
        rows
          .map((row) => String(row.created_by ?? "").trim())
          .filter((id) => Boolean(id)),
      ),
    ];

    const profileMap = new Map<string, ProfileJoin>();
    if (creatorIds.length > 0) {
      const { data: profiles, error: profileError } = await supabaseAdmin
        .from("user_profiles")
        .select("id, full_name, email")
        .in("id", creatorIds);

      if (profileError) {
        return { success: false, data: [], error: profileError.message };
      }

      for (const profile of profiles ?? []) {
        profileMap.set(String(profile.id), {
          id: String(profile.id),
          full_name: profile.full_name,
          email: profile.email,
        });
      }
    }

    const items: ApWriteoffListItem[] = rows.map((row) => {
      const createdBy = String(row.created_by ?? "").trim();
      const status = String(row.status ?? "");
      const approvalStatus = String(row.approval_status ?? "");
      return {
        id: String(row.id),
        doc_no: String(row.doc_no ?? ""),
        doc_date: String(row.doc_date ?? ""),
        created_at: String(row.created_at ?? ""),
        created_by_name: resolveCreatorName(profileMap.get(createdBy)),
        grand_total: roundMoney(toMoney(row.grand_total)),
        remark: row.remark ? String(row.remark) : null,
        status,
        approval_status: approvalStatus,
        list_status: resolveApWriteoffListStatus(status, approvalStatus),
      };
    });

    return { success: true, data: items, error: null };
  } catch (err) {
    return {
      success: false,
      data: [],
      error:
        err instanceof Error
          ? err.message
          : "โหลดประวัติใบสำคัญตัดหนี้สูญไม่สำเร็จ",
    };
  }
}

export async function getApWriteoffPreview(
  documentId: string,
): Promise<GetDocumentPreviewResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { data: null, error: owner.error };
    }

    const id = documentId?.trim() ?? "";
    if (!id || !UUID_RE.test(id)) {
      return { data: null, error: "รหัสเอกสารไม่ถูกต้อง" };
    }

    const supabaseAdmin = createSupabaseServerClient();
    const { data: header, error: headerError } = await supabaseAdmin
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_type,
        doc_date,
        status,
        approval_status,
        grand_total,
        remark,
        notes,
        contacts!documents_contact_id_fkey (
          company_name
        )
      `,
      )
      .eq("id", id)
      .eq("doc_type", WRITEOFF_DOC_TYPE)
      .maybeSingle();

    if (headerError) {
      return { data: null, error: headerError.message };
    }
    if (!header) {
      return { data: null, error: "ไม่พบใบสำคัญตัดหนี้สูญที่ระบุ" };
    }

    const { data: allocations, error: allocError } = await supabaseAdmin
      .from("document_allocations")
      .select(
        `
        id,
        allocated_amount,
        adjustment_reason,
        documents!document_allocations_invoice_doc_id_fkey (
          doc_no,
          doc_type
        )
      `,
      )
      .eq("receipt_doc_id", id)
      .order("created_at", { ascending: true });

    if (allocError) {
      return { data: null, error: allocError.message };
    }

    const contact = unwrapContact(
      header.contacts as ContactJoin | ContactJoin[] | null,
    );
    const docNo = String(header.doc_no ?? "");

    return {
      data: {
        id: String(header.id),
        doc_no: docNo,
        doc_type: String(header.doc_type ?? WRITEOFF_DOC_TYPE),
        doc_date: String(header.doc_date ?? ""),
        status: String(header.status ?? ""),
        approval_status: String(header.approval_status ?? ""),
        grand_total: roundMoney(toMoney(header.grand_total)),
        remark: header.remark ? String(header.remark) : null,
        notes: header.notes ? String(header.notes) : null,
        contact_name: contact?.company_name?.trim() || null,
        detail_href: `/purchases/${encodeURIComponent(docNo)}`,
        items: [],
        allocations: (allocations ?? []).map((row) => {
          const invoice = unwrapOne(
            row.documents as InvoiceDocJoin | InvoiceDocJoin[] | null,
          );
          return {
            id: String(row.id),
            target_doc_no: String(invoice?.doc_no ?? "—"),
            target_doc_type: String(invoice?.doc_type ?? ""),
            allocated_amount: roundMoney(toMoney(row.allocated_amount)),
            adjustment_reason: row.adjustment_reason
              ? String(row.adjustment_reason)
              : null,
          };
        }),
      },
      error: null,
    };
  } catch (err) {
    return {
      data: null,
      error:
        err instanceof Error
          ? err.message
          : "โหลดรายละเอียดใบสำคัญตัดหนี้สูญไม่สำเร็จ",
    };
  }
}

export async function deleteApWriteoffDraft(
  documentId: string,
): Promise<DeleteDraftDocumentResult> {
  try {
    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { success: false, docNo: null, error: owner.error };
    }

    const id = documentId?.trim() ?? "";
    if (!id || !UUID_RE.test(id)) {
      return { success: false, docNo: null, error: "รหัสเอกสารไม่ถูกต้อง" };
    }

    const supabaseAdmin = createSupabaseServerClient();
    const { data: document, error: fetchError } = await supabaseAdmin
      .from("documents")
      .select("id, doc_no, doc_type, status, approval_status")
      .eq("id", id)
      .maybeSingle();

    if (fetchError) {
      return { success: false, docNo: null, error: fetchError.message };
    }
    if (!document) {
      return { success: false, docNo: null, error: "ไม่พบเอกสาร" };
    }
    if (String(document.doc_type ?? "") !== WRITEOFF_DOC_TYPE) {
      return {
        success: false,
        docNo: String(document.doc_no ?? ""),
        error: "ลบได้เฉพาะใบสำคัญตัดหนี้สูญเจ้าหนี้ (AP_WRITEOFF)",
      };
    }

    const listStatus = resolveApWriteoffListStatus(
      String(document.status ?? ""),
      String(document.approval_status ?? ""),
    );
    if (listStatus === "PENDING") {
      return {
        success: false,
        docNo: String(document.doc_no ?? ""),
        error: "เอกสารรออนุมัติ — ลบไม่ได้จนกว่าจะถูกปฏิเสธหรือยกเลิกคำขอ",
      };
    }
    if (listStatus !== "DRAFT") {
      return {
        success: false,
        docNo: String(document.doc_no ?? ""),
        error: `ลบได้เฉพาะเอกสารสถานะ DRAFT (ปัจจุบัน: ${listStatus})`,
      };
    }

    const { error: allocError } = await supabaseAdmin
      .from("document_allocations")
      .delete()
      .eq("receipt_doc_id", id);
    if (allocError) {
      return {
        success: false,
        docNo: String(document.doc_no ?? ""),
        error: allocError.message,
      };
    }

    const result = await deleteDraftDocument(id);
    revalidatePath(LIST_PATH);
    revalidatePath("/purchases");
    return result;
  } catch (err) {
    return {
      success: false,
      docNo: null,
      error:
        err instanceof Error ? err.message : "ลบเอกสารร่างไม่สำเร็จ",
    };
  }
}

export async function voidApWriteoff(
  documentIdOrPayload: string | VoidDocumentActionInput,
  reason?: string,
): Promise<VoidDocumentResult> {
  const result = await voidDocumentAction(documentIdOrPayload, reason);
  revalidatePath(LIST_PATH);
  return result;
}
