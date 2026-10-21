"use server";

/**
 * Phase 5 / 18 — Receive Payment Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSessionUserId } from "@/lib/auth/current-user";
import {
  AR_OUTSTANDING_DOC_TYPES,
  AR_REC_INVOICE_DOC_TYPES,
} from "@/lib/constants/document";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { syncBillingNotesAfterInvoicePayment } from "@/lib/actions/finance/billing-note-status";
import { roundMoney } from "@/lib/utils/payment-fifo";
import {
  isCreditNoteDocType,
  summarizeRecPayment,
} from "@/lib/utils/rec-payment-summary";
import { NET_CASH_NEGATIVE_MESSAGE } from "@/lib/validations/payment-knockoff";
import {
  isOverdue,
  resolveDueDate,
  todayIsoDate,
} from "@/lib/utils/outstanding-summary";
import type {
  CustomerPaymentContext,
  DebtorOption,
  DepositAllocationInput,
  KnockoffAllocationInput,
  ProcessPaymentKnockoffResult,
  UnpaidInvoice,
} from "@/types/payment";
import { getAvailableDepositsForContact } from "@/lib/actions/finance/available-deposits";
import {
  OUTSTANDING_ALLOCATION_EMBED,
  mapAllocationSources,
  resolveAllocatedAmount,
  sumAllocationSources,
  type NestedAllocationRow,
} from "@/lib/finance/invoice-allocation-summary";
import { logAuditTrail } from "@/lib/supabase/auditService";

const OPEN_PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "Pending"] as const;
/** Lifecycle status for open AR items on the REC form (invoices + CN). */
const AR_OUTSTANDING_STATUS = "ISSUED" as const;
const DOCUMENT_ATTACHMENTS_BUCKET = "document_attachments";
const CASH_ACCOUNT_SENTINEL = "CASH";
const ALLOWED_SLIP_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf",
]);

type ContactJoin = {
  id?: string;
  company_name?: string | null;
  credit_days?: number | null;
};

type DebtorDocRow = {
  contact_id: string | null;
  doc_date?: string | null;
  due_date?: string | null;
  grand_total?: number | string | null;
  total_amount?: number | string | null;
  paid_amount?: number | string | null;
  contacts: ContactJoin | ContactJoin[] | null;
};

type InvoiceDocRow = {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  doc_type: string | null;
  payment_status: string | null;
  grand_total: number | string | null;
  total_amount: number | string | null;
  paid_amount: number | string | null;
  contact_id: string | null;
  allocations?: NestedAllocationRow[] | NestedAllocationRow | null;
};

function unwrapContact(
  value: ContactJoin | ContactJoin[] | null,
): ContactJoin | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Remaining face value on `documents` — always unsigned.
 * CN credit stays positive; UI/knock-off decides the sign later.
 */
function resolveRemainingAmount(
  grandTotal: number,
  paidAmount: number,
): number {
  return roundMoney(grandTotal - paidAmount);
}

/**
 * Outstanding AR summary by customer (Server-calculated overdue + oldest invoice).
 */
export async function getOutstandingSummary(): Promise<DebtorOption[]> {
  return getDebtorsList();
}

/**
 * Customers with open AR invoices and remaining balance > 0.
 * Includes outstanding_total / overdue_amount / oldest_invoice_date.
 */
export async function getDebtorsList(): Promise<DebtorOption[]> {
  try {
    const supabaseAdmin = createSupabaseServerClient();
    const today = todayIsoDate();

    const { data, error } = await supabaseAdmin
      .from("documents")
      .select(
        `
        contact_id,
        doc_date,
        due_date,
        grand_total,
        total_amount,
        paid_amount,
        contacts:contact_id (
          id,
          company_name,
          credit_days
        )
      `,
      )
      .in("payment_status", [...OPEN_PAYMENT_STATUSES])
      .in("doc_type", [...AR_REC_INVOICE_DOC_TYPES])
      .eq("status", AR_OUTSTANDING_STATUS)
      .or("is_voided.is.null,is_voided.eq.false");

    if (error) {
      console.error("Error fetching debtors:", error.message);
      return [];
    }

    const grouped = new Map<
      string,
      {
        name: string;
        outstanding_total: number;
        overdue_amount: number;
        invoice_count: number;
        oldest_invoice_date: string | null;
      }
    >();

    for (const doc of (data ?? []) as DebtorDocRow[]) {
      const contact = unwrapContact(doc.contacts);
      const contactId = doc.contact_id?.trim() || contact?.id || "";
      if (!contactId) continue;

      const grand = toMoney(doc.grand_total ?? doc.total_amount);
      const remaining = resolveRemainingAmount(grand, toMoney(doc.paid_amount));
      if (remaining <= 0) continue;

      const docDate = doc.doc_date ? String(doc.doc_date) : "";
      const due = resolveDueDate(docDate, doc.due_date, contact?.credit_days);
      const overdue = isOverdue(due, today) ? remaining : 0;

      const existing = grouped.get(contactId);
      if (!existing) {
        grouped.set(contactId, {
          name: contact?.company_name?.trim() || "ไม่ระบุชื่อ",
          outstanding_total: remaining,
          overdue_amount: overdue,
          invoice_count: 1,
          oldest_invoice_date: docDate || null,
        });
        continue;
      }

      existing.outstanding_total = roundMoney(
        existing.outstanding_total + remaining,
      );
      existing.overdue_amount = roundMoney(existing.overdue_amount + overdue);
      existing.invoice_count += 1;
      if (docDate) {
        if (
          !existing.oldest_invoice_date ||
          docDate < existing.oldest_invoice_date
        ) {
          existing.oldest_invoice_date = docDate;
        }
      }
    }

    return Array.from(grouped.entries())
      .map(([id, row]) => ({
        id,
        name: row.name,
        outstanding_total: row.outstanding_total,
        invoice_count: row.invoice_count,
        overdue_amount: row.overdue_amount,
        oldest_invoice_date: row.oldest_invoice_date,
      }))
      .filter((row) => row.outstanding_total > 0)
      .sort((a, b) => b.outstanding_total - a.outstanding_total);
  } catch (err) {
    console.error("Error fetching debtors:", err);
    return [];
  }
}

/** Unpaid invoices + unused CN + available DEP_IN for one customer (`contact_id` from URL). */
export async function getUnpaidInvoicesByCustomer(
  contactId: string,
): Promise<CustomerPaymentContext> {
  const trimmed = contactId?.trim() ?? "";
  if (!trimmed) {
    return { invoices: [], availableDeposits: [] };
  }

  try {
    const supabaseAdmin = createSupabaseServerClient();
    const { data, error } = await supabaseAdmin
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_date,
        doc_type,
        payment_status,
        grand_total,
        total_amount,
        paid_amount,
        contact_id,
        ${OUTSTANDING_ALLOCATION_EMBED}
      `,
      )
      .eq("contact_id", trimmed)
      .in("payment_status", [...OPEN_PAYMENT_STATUSES])
      .in("doc_type", [...AR_OUTSTANDING_DOC_TYPES])
      .eq("status", AR_OUTSTANDING_STATUS)
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    if (error) {
      console.error("Error fetching invoices for customer:", error.message);
      return { invoices: [], availableDeposits: [] };
    }

    const rows = (data ?? []) as InvoiceDocRow[];
    const invoices = rows
      .map((doc) => {
        const grandTotal = roundMoney(
          toMoney(doc.grand_total ?? doc.total_amount),
        );
        const paidAmount = roundMoney(toMoney(doc.paid_amount));
        const allocationSources = mapAllocationSources(doc.allocations);
        const allocatedAmount = resolveAllocatedAmount(
          sumAllocationSources(allocationSources),
          paidAmount,
        );
        const remaining = roundMoney(grandTotal - allocatedAmount);

        return {
          id: doc.id,
          display_doc_no: doc.doc_no?.trim() || "ไม่ระบุ",
          document_date: doc.doc_date ? String(doc.doc_date) : "",
          doc_type: doc.doc_type ?? "",
          payment_status: String(doc.payment_status ?? "UNPAID"),
          grand_total: grandTotal,
          net_amount_calc: grandTotal,
          paid_amount: paidAmount,
          allocated_amount: allocatedAmount,
          allocation_sources: allocationSources,
          remaining_balance: remaining,
          contact_id: doc.contact_id ?? trimmed,
        } satisfies UnpaidInvoice;
      })
      .filter((inv) => inv.remaining_balance > 0);

    const availableDeposits = await getAvailableDepositsForContact(
      trimmed,
      "DEP_IN",
      supabaseAdmin,
    );

    return { invoices, availableDeposits };
  } catch (err) {
    console.error("Error fetching invoices for customer:", err);
    return { invoices: [], availableDeposits: [] };
  }
}

const MONEY_EPS = 0.02;

function parseAllocationsJson(raw: FormDataEntryValue | null): KnockoffAllocationInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          invoice_id: String(item.invoice_id ?? "").trim(),
          allocated_amount: roundMoney(Number(item.allocated_amount ?? 0)),
          wht_amount: roundMoney(Number(item.wht_amount ?? 0)),
        };
      })
      .filter((row) => row.invoice_id.length > 0);
  } catch {
    return [];
  }
}

function parseDepositsJson(
  raw: FormDataEntryValue | null,
): DepositAllocationInput[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => {
        const item = row as Record<string, unknown>;
        return {
          deposit_id: String(item.deposit_id ?? "").trim(),
          allocated_amount: roundMoney(Number(item.allocated_amount ?? 0)),
        };
      })
      .filter((row) => row.deposit_id.length > 0 && row.allocated_amount > 0);
  } catch {
    return [];
  }
}

async function uploadArPaymentSlip(
  supabase: SupabaseClient,
  file: File,
): Promise<{ url: string; path: string } | { error: string }> {
  const mimeType = (file.type || "").toLowerCase();
  if (mimeType && !ALLOWED_SLIP_MIME_TYPES.has(mimeType)) {
    return {
      error: `ประเภทไฟล์ไม่รองรับ (${mimeType || "unknown"}) — ใช้ JPG/PNG/WEBP/GIF/PDF`,
    };
  }

  const maxBytes = 10 * 1024 * 1024;
  if (file.size > maxBytes) {
    return { error: "ไฟล์สลิปใหญ่เกิน 10MB" };
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
  const objectPath = `ar-payment/${yyyy}/${mm}/${crypto.randomUUID()}${extFromName}`;
  const buffer = Buffer.from(await file.arrayBuffer());

  const { error: uploadError } = await supabase.storage
    .from(DOCUMENT_ATTACHMENTS_BUCKET)
    .upload(objectPath, buffer, {
      contentType: mimeType || "application/octet-stream",
      upsert: false,
    });

  if (uploadError) {
    return {
      error: uploadError.message ?? "อัปโหลดสลิปขึ้น Storage ไม่สำเร็จ",
    };
  }

  const { data: publicData } = supabase.storage
    .from(DOCUMENT_ATTACHMENTS_BUCKET)
    .getPublicUrl(objectPath);

  const url = publicData?.publicUrl?.trim();
  if (!url) {
    return { error: "อัปโหลดสลิปสำเร็จ แต่สร้าง URL ไม่ได้" };
  }

  return { url, path: objectPath };
}

async function removeUploadedSlip(
  supabase: SupabaseClient,
  path: string | null,
): Promise<void> {
  if (!path) return;
  await supabase.storage.from(DOCUMENT_ATTACHMENTS_BUCKET).remove([path]);
}

type AppliedCnDoc = {
  id: string;
  doc_no: string;
  allocated_amount: number;
  previous_status: string;
  previous_payment_status: string;
  previous_paid_amount: number;
  next_status: string;
  next_payment_status: string;
  paid_amount: number;
};

function parseArReceiptRpc(rpcData: unknown): {
  success: boolean;
  error: string | null;
  receiptDocId: string | null;
  receiptDocNo: string | null;
  appliedCnDocs: AppliedCnDoc[];
} {
  if (typeof rpcData === "string") {
    const trimmed = rpcData.trim();
    if (!trimmed) {
      return {
        success: false,
        error: "RPC process_ar_receipt_transaction ไม่คืนผลลัพธ์",
        receiptDocId: null,
        receiptDocNo: null,
        appliedCnDocs: [],
      };
    }
    try {
      return parseArReceiptRpc(JSON.parse(trimmed) as unknown);
    } catch {
      return {
        success: false,
        error: trimmed,
        receiptDocId: null,
        receiptDocNo: null,
        appliedCnDocs: [],
      };
    }
  }

  if (rpcData == null || typeof rpcData !== "object") {
    return {
      success: false,
      error: "RPC process_ar_receipt_transaction ไม่คืนผลลัพธ์",
      receiptDocId: null,
      receiptDocNo: null,
      appliedCnDocs: [],
    };
  }

  const payload = rpcData as Record<string, unknown>;
  const errorRaw = payload.error ?? payload.message ?? null;
  const error =
    errorRaw != null && String(errorRaw).trim() ? String(errorRaw).trim() : null;
  const successFlag = payload.success;
  const success =
    successFlag === false || successFlag === "false" ? false : error == null;

  const appliedRaw = payload.applied_cn_docs;
  const appliedCnDocs = Array.isArray(appliedRaw)
    ? appliedRaw.flatMap((row) => {
        if (row == null || typeof row !== "object") return [];
        const item = row as Record<string, unknown>;
        const id = String(item.id ?? "").trim();
        if (!id) return [];
        return [
          {
            id,
            doc_no: String(item.doc_no ?? "").trim() || id,
            allocated_amount: roundMoney(Number(item.allocated_amount ?? 0)),
            previous_status: String(item.previous_status ?? "ISSUED"),
            previous_payment_status: String(
              item.previous_payment_status ?? "UNPAID",
            ),
            previous_paid_amount: roundMoney(
              Number(item.previous_paid_amount ?? 0),
            ),
            next_status: String(item.next_status ?? "ISSUED"),
            next_payment_status: String(item.next_payment_status ?? "UNPAID"),
            paid_amount: roundMoney(Number(item.paid_amount ?? 0)),
          },
        ];
      })
    : [];

  return {
    success,
    error,
    receiptDocId:
      payload.receipt_doc_id != null ? String(payload.receipt_doc_id) : null,
    receiptDocNo:
      payload.receipt_doc_no != null
        ? String(payload.receipt_doc_no)
        : payload.doc_no != null
          ? String(payload.doc_no)
          : null,
    appliedCnDocs,
  };
}

/**
 * Knock-off payment (AR):
 * 1) Upload slip → Storage (optional)
 * 2) One RPC `process_ar_receipt_transaction` writes REC, payment_transactions,
 *    document_allocations, invoice/CN balances, and DEP_IN deposit_deducted
 * 3) Sync billing notes and write the audit trail after the RPC commits
 */
export async function processPaymentKnockoff(
  formData: FormData,
): Promise<ProcessPaymentKnockoffResult> {
  const supabase = createSupabaseServerClient();
  let slipStoragePath: string | null = null;
  let receiptCommitted = false;

  try {
    const contactId = String(formData.get("contact_id") ?? "").trim();
    const paymentDateRaw = String(formData.get("payment_date") ?? "").trim();
    const bankAccountRaw = String(formData.get("bank_account_id") ?? "").trim();
    const referenceNo =
      String(formData.get("reference_no") ?? "").trim() || null;
    const cashAmount = roundMoney(Number(formData.get("amount") ?? 0));
    const headerWht = roundMoney(Number(formData.get("wht_amount") ?? 0));
    const allocations = parseAllocationsJson(formData.get("allocations_json"));
    const depositAllocations = parseDepositsJson(
      formData.get("deposits_json"),
    );
    const slipFile = formData.get("slip_file");

    const paymentDate = /^\d{4}-\d{2}-\d{2}$/.test(paymentDateRaw)
      ? paymentDateRaw
      : todayIsoDate();

    if (!contactId) {
      return { success: false, error: "ไม่พบรหัสลูกค้า" };
    }
    if (!bankAccountRaw) {
      return {
        success: false,
        error: "กรุณาเลือกสมุดบัญชีธนาคาร หรือเงินสด",
      };
    }
    if (cashAmount < 0 || headerWht < 0) {
      return { success: false, error: "ยอดเงินต้องไม่ติดลบ" };
    }

    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { success: false, error: owner.error };
    }

    const depositTotal = roundMoney(
      depositAllocations.reduce((sum, row) => sum + row.allocated_amount, 0),
    );

    const isCash = bankAccountRaw === CASH_ACCOUNT_SENTINEL;
    let bankAccountId: string | null = null;

    if (!isCash) {
      bankAccountId = bankAccountRaw;
      const { data: bank, error: bankError } = await supabase
        .from("mst_bank_accounts")
        .select("id, is_active")
        .eq("id", bankAccountId)
        .maybeSingle();

      if (bankError || !bank) {
        return { success: false, error: "ไม่พบสมุดบัญชีที่เลือก" };
      }
      if (bank.is_active === false) {
        return { success: false, error: "สมุดบัญชีนี้ถูกปิดการใช้งานแล้ว" };
      }
    }

    const activeAllocations = allocations.filter(
      (row) => row.allocated_amount > 0 || row.wht_amount > 0,
    );
    if (activeAllocations.length === 0) {
      return {
        success: false,
        error: "กรุณากด Auto-Allocate หรือระบุยอดตัดหนี้ในบิลอย่างน้อย 1 รายการ",
      };
    }

    const invoiceIds = activeAllocations.map((row) => row.invoice_id);
    const { data: invoices, error: invoicesError } = await supabase
      .from("documents")
      .select(
        "id, contact_id, grand_total, total_amount, paid_amount, payment_status, doc_type, status, is_voided, doc_no",
      )
      .in("id", invoiceIds);

    if (invoicesError) {
      return {
        success: false,
        error: invoicesError.message ?? "โหลดบิลต้นทางไม่สำเร็จ",
      };
    }

    const invoiceMap = new Map(
      (invoices ?? []).map((row) => [row.id as string, row]),
    );

    const invoiceAllocations: typeof activeAllocations = [];
    const cnAllocations: typeof activeAllocations = [];

    for (const alloc of activeAllocations) {
      const invoice = invoiceMap.get(alloc.invoice_id);
      if (!invoice) {
        return {
          success: false,
          error: `ไม่พบบิลต้นทาง ${alloc.invoice_id}`,
        };
      }
      if (invoice.contact_id !== contactId) {
        return {
          success: false,
          error: "พบบิลที่ไม่ใช่ของลูกค้ารายนี้",
        };
      }
      if (invoice.is_voided === true) {
        return { success: false, error: "มีบิลที่ถูกยกเลิก ไม่สามารถตัดยอดได้" };
      }
      if (invoice.status !== "ISSUED" && invoice.status !== "COMPLETED") {
        return {
          success: false,
          error: "ตัดยอดได้เฉพาะบิลที่ออกแล้ว (ISSUED)",
        };
      }

      if (isCreditNoteDocType(String(invoice.doc_type ?? ""))) {
        if (alloc.wht_amount > MONEY_EPS) {
          return {
            success: false,
            error: "ใบลดหนี้ (CN) ไม่สามารถระบุ WHT ได้",
          };
        }
        cnAllocations.push(alloc);
        continue;
      }

      if (
        !AR_REC_INVOICE_DOC_TYPES.includes(
          invoice.doc_type as (typeof AR_REC_INVOICE_DOC_TYPES)[number],
        )
      ) {
        return {
          success: false,
          error: `ประเภทเอกสารไม่รองรับการตัดหนี้: ${invoice.doc_type}`,
        };
      }
      invoiceAllocations.push(alloc);
    }

    if (invoiceAllocations.length === 0) {
      return {
        success: false,
        error: "กรุณาเลือกบิลขายที่ต้องการตัดยอดอย่างน้อย 1 รายการ",
      };
    }

    const sumAllocated = roundMoney(
      invoiceAllocations.reduce((sum, row) => sum + row.allocated_amount, 0),
    );
    const sumWht = roundMoney(
      invoiceAllocations.reduce((sum, row) => sum + row.wht_amount, 0),
    );
    const cnTotal = roundMoney(
      cnAllocations.reduce((sum, row) => sum + row.allocated_amount, 0),
    );
    const recSummary = summarizeRecPayment({
      totalInvoices: sumAllocated,
      totalCnApplied: cnTotal,
      depositApplied: depositTotal,
      whtAmount: headerWht,
    });

    if (recSummary.netCash < -MONEY_EPS) {
      return { success: false, error: NET_CASH_NEGATIVE_MESSAGE };
    }

    const expectedNetCash = roundMoney(Math.max(0, recSummary.netCash));

    if (depositTotal > sumAllocated + MONEY_EPS) {
      return {
        success: false,
        error: `ยอดมัดจำที่ใช้ (${depositTotal.toFixed(2)}) เกินยอดตัดหนี้ (${sumAllocated.toFixed(2)})`,
      };
    }
    if (cnTotal > sumAllocated + MONEY_EPS) {
      return { success: false, error: NET_CASH_NEGATIVE_MESSAGE };
    }
    if (
      Math.abs(
        sumAllocated -
          (cashAmount + depositTotal + cnTotal + headerWht),
      ) > MONEY_EPS
    ) {
      return {
        success: false,
        error: `ยอดตัดหนี้ (${sumAllocated.toFixed(2)}) ต้องเท่ากับ ยอดโอน (${cashAmount.toFixed(2)}) + มัดจำ (${depositTotal.toFixed(2)}) + ใบลดหนี้ (${cnTotal.toFixed(2)}) + WHT (${headerWht.toFixed(2)})`,
      };
    }
    if (Math.abs(cashAmount - expectedNetCash) > MONEY_EPS) {
      return {
        success: false,
        error: `ยอดรับชำระจริงต้องเป็น ${expectedNetCash.toFixed(2)} (บิล − ใบลดหนี้ − มัดจำ − WHT)`,
      };
    }
    if (Math.abs(sumWht - headerWht) > MONEY_EPS) {
      return {
        success: false,
        error: `ยอด WHT รวมในบิล (${sumWht.toFixed(2)}) ไม่ตรงกับยอด WHT ส่วนหัว (${headerWht.toFixed(2)})`,
      };
    }
    if (
      cashAmount <= 0 &&
      headerWht <= 0 &&
      depositTotal <= 0 &&
      cnTotal <= 0
    ) {
      return {
        success: false,
        error: "กรุณาระบุยอดเงินโอน มัดจำ ใบลดหนี้ หรือ WHT",
      };
    }

    for (const alloc of invoiceAllocations) {
      const invoice = invoiceMap.get(alloc.invoice_id)!;
      const grandTotal = toMoney(invoice.grand_total ?? invoice.total_amount);
      const paidAmount = toMoney(invoice.paid_amount);
      const remaining = roundMoney(grandTotal - paidAmount);
      const apply = roundMoney(alloc.allocated_amount);

      if (apply > remaining + MONEY_EPS) {
        return {
          success: false,
          error: `ยอดตัดหนี้เกินยอดค้างของบิล (เหลือ ${remaining.toFixed(2)})`,
        };
      }
    }

    if (cnAllocations.length > 0) {
      const cnIds = cnAllocations.map((row) => row.invoice_id);
      const { data: priorCnAllocs } = await supabase
        .from("document_allocations")
        .select("invoice_doc_id, allocated_amount")
        .in("invoice_doc_id", cnIds);

      const usedByCn = new Map<string, number>();
      for (const row of priorCnAllocs ?? []) {
        const id = String(row.invoice_doc_id);
        usedByCn.set(
          id,
          roundMoney(
            (usedByCn.get(id) ?? 0) + toMoney(row.allocated_amount),
          ),
        );
      }

      for (const alloc of cnAllocations) {
        const creditNote = invoiceMap.get(alloc.invoice_id)!;
        const grand = toMoney(
          creditNote.grand_total ?? creditNote.total_amount,
        );
        const used = roundMoney(
          Math.max(
            usedByCn.get(alloc.invoice_id) ?? 0,
            toMoney(creditNote.paid_amount),
          ),
        );
        const remaining = roundMoney(grand - used);
        if (alloc.allocated_amount > remaining + MONEY_EPS) {
          return {
            success: false,
            error: `ยอดใบลดหนี้เกินคงเหลือ (เหลือ ${remaining.toFixed(2)})`,
          };
        }
      }
    }

    // Validate deposits (DEP_IN) before creating REC
    if (depositAllocations.length > 0) {
      const depositIds = depositAllocations.map((row) => row.deposit_id);
      const { data: deposits, error: depositsError } = await supabase
        .from("documents")
        .select(
          "id, contact_id, grand_total, deposit_deducted, doc_type, status, is_voided",
        )
        .in("id", depositIds);

      if (depositsError) {
        return {
          success: false,
          error: depositsError.message ?? "โหลดเอกสารมัดจำไม่สำเร็จ",
        };
      }

      const depositMap = new Map(
        (deposits ?? []).map((row) => [row.id as string, row]),
      );

      const { data: priorDepositAllocs } = await supabase
        .from("document_allocations")
        .select("invoice_doc_id, allocated_amount")
        .in("invoice_doc_id", depositIds);

      const usedByDeposit = new Map<string, number>();
      for (const row of priorDepositAllocs ?? []) {
        const id = String(row.invoice_doc_id);
        usedByDeposit.set(
          id,
          roundMoney(
            (usedByDeposit.get(id) ?? 0) + toMoney(row.allocated_amount),
          ),
        );
      }

      for (const alloc of depositAllocations) {
        const deposit = depositMap.get(alloc.deposit_id);
        if (!deposit) {
          return {
            success: false,
            error: `ไม่พบเอกสารมัดจำ ${alloc.deposit_id}`,
          };
        }
        if (deposit.contact_id !== contactId) {
          return {
            success: false,
            error: "พบมัดจำที่ไม่ใช่ของลูกค้ารายนี้",
          };
        }
        if (deposit.is_voided === true) {
          return { success: false, error: "มีมัดจำที่ถูกยกเลิก" };
        }
        if (deposit.doc_type !== "DEP_IN") {
          return {
            success: false,
            error: `ประเภทมัดจำไม่ถูกต้อง: ${deposit.doc_type}`,
          };
        }
        const grand = toMoney(deposit.grand_total);
        const used = roundMoney(
          Math.max(
            usedByDeposit.get(alloc.deposit_id) ?? 0,
            toMoney(deposit.deposit_deducted),
          ),
        );
        const remaining = roundMoney(grand - used);
        if (alloc.allocated_amount > remaining + MONEY_EPS) {
          return {
            success: false,
            error: `ยอดมัดจำเกินคงเหลือ (เหลือ ${remaining.toFixed(2)})`,
          };
        }
      }
    }

    let slipUrl: string | null = null;
    if (slipFile instanceof File && slipFile.size > 0) {
      const uploaded = await uploadArPaymentSlip(supabase, slipFile);
      if ("error" in uploaded) {
        return { success: false, error: uploaded.error };
      }
      slipUrl = uploaded.url;
      slipStoragePath = uploaded.path;
    }

    const receiptGrandTotal = recSummary.totalInvoices;
    const netCashAmount = expectedNetCash;
    const notes = `AR Knock-off | invoices=${sumAllocated} | cash=${netCashAmount} | cn=${cnTotal} | deposit=${depositTotal} | wht=${headerWht}${referenceNo ? ` | ref=${referenceNo}` : ""}`;

    const { data: rpcData, error: rpcError } = await supabase.rpc(
      "process_ar_receipt_transaction",
      {
        p_contact_id: contactId,
        p_payment_date: paymentDate,
        p_payment_method: isCash ? "CASH" : "BANK_TRANSFER",
        p_bank_account_id: bankAccountId,
        p_net_cash_amount: netCashAmount,
        p_receipt_grand_total: receiptGrandTotal,
        p_header_wht: headerWht,
        p_reference_no: referenceNo,
        p_slip_url: slipUrl,
        p_original_file_name:
          slipFile instanceof File && slipFile.size > 0
            ? slipFile.name.slice(0, 255)
            : null,
        p_notes: notes,
        p_user_id: owner.userId,
        p_invoice_allocations: invoiceAllocations.map((row) => ({
          invoice_id: row.invoice_id,
          allocated_amount: row.allocated_amount,
          wht_amount: row.wht_amount,
        })),
        p_cn_allocations: cnAllocations.map((row) => ({
          invoice_id: row.invoice_id,
          allocated_amount: row.allocated_amount,
        })),
        p_deposit_allocations: depositAllocations.map((row) => ({
          deposit_id: row.deposit_id,
          allocated_amount: row.allocated_amount,
        })),
      },
    );

    const parsed = parseArReceiptRpc(rpcData);
    if (rpcError || !parsed.success) {
      await removeUploadedSlip(supabase, slipStoragePath);
      return {
        success: false,
        error:
          rpcError?.message ??
          parsed.error ??
          "สร้างใบเสร็จรับเงิน (REC) ไม่สำเร็จ",
      };
    }

    receiptCommitted = true;
    const receiptDocId = parsed.receiptDocId;
    const receiptDocNo = parsed.receiptDocNo ?? "";
    const appliedCnDocs = parsed.appliedCnDocs;
    if (!receiptDocId || !receiptDocNo) {
      return {
        success: false,
        error: "สร้างใบเสร็จรับเงิน (REC) ไม่สำเร็จ",
      };
    }

    if (invoiceAllocations.length > 0) {
      const bnSync = await syncBillingNotesAfterInvoicePayment(
        supabase,
        invoiceAllocations.map((row) => row.invoice_id),
      );
      if (bnSync.error) {
        return {
          success: false,
          error: `บันทึกใบเสร็จ ${receiptDocNo} แล้ว แต่อัปเดตสถานะใบวางบิลไม่สำเร็จ: ${bnSync.error}`,
          receipt_doc_no: receiptDocNo,
        };
      }
    }

    for (const cn of appliedCnDocs) {
      const cnAudit = await logAuditTrail(
        "documents",
        cn.id,
        "UPDATE",
        {
          id: cn.id,
          doc_no: cn.doc_no,
          doc_type: "CN",
          status: cn.previous_status,
          payment_status: cn.previous_payment_status,
          paid_amount: cn.previous_paid_amount,
        },
        {
          audit_event: "CN_KNOCKOFF",
          id: cn.id,
          doc_no: cn.doc_no,
          doc_type: "CN",
          status: cn.next_status,
          payment_status: cn.next_payment_status,
          paid_amount: cn.paid_amount,
          allocated_amount: cn.allocated_amount,
          applied_on_receipt: receiptDocNo,
        },
      );
      if (!cnAudit.success) {
        console.error("[processPaymentKnockoff][audit CN]", cnAudit.error);
      }
    }

    const recAudit = await logAuditTrail(
      "documents",
      receiptDocId,
      "INSERT",
      null,
      {
        audit_event: cnTotal > 0 ? "CN_KNOCKOFF" : "CREATE",
        id: receiptDocId,
        doc_no: receiptDocNo,
        doc_type: "REC",
        status: "ISSUED",
        grand_total: receiptGrandTotal,
        net_cash: netCashAmount,
        cn_applied: cnTotal > 0,
        cn_applied_amount: cnTotal,
        cn_doc_nos: appliedCnDocs.map((row) => row.doc_no),
        deposit_applied: depositTotal,
        wht_amount: headerWht,
        invoice_count: invoiceAllocations.length,
        summary:
          cnTotal > 0
            ? `ใบเสร็จ ${receiptDocNo} ใช้ใบลดหนี้หักลดหนี้ ${appliedCnDocs
                .map((row) => row.doc_no)
                .join(", ")} จำนวน ${cnTotal.toFixed(2)} บาท`
            : `สร้างใบเสร็จรับเงิน ${receiptDocNo}`,
      },
    );
    if (!recAudit.success) {
      console.error("[processPaymentKnockoff][audit REC]", recAudit.error);
    }

    revalidatePath("/finance/payments");
    revalidatePath("/finance/ap-ar");
    revalidatePath("/finance/deposits");
    revalidatePath("/finance/billing-notes");
    revalidatePath("/sales");

    return {
      success: true,
      error: null,
      receipt_doc_no: receiptDocNo,
    };
  } catch (err) {
    if (!receiptCommitted) {
      await removeUploadedSlip(supabase, slipStoragePath);
    }
    const message =
      err instanceof Error ? err.message : "ตัดยอดชำระเงินไม่สำเร็จ";
    return { success: false, error: message };
  }
}
