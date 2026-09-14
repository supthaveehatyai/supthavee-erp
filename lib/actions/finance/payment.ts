"use server";

/**
 * Phase 5 / 18 — Receive Payment Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 */

import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateDocumentNumber } from "@/lib/actions/document-actions";
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
  loadInvoiceAllocationSummaries,
  resolveAllocatedAmount,
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
        contact_id
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
    const allocationSummaries = await loadInvoiceAllocationSummaries(
      supabaseAdmin,
      rows.map((row) => row.id),
    );

    const invoices = rows
      .map((doc) => {
        const grandTotal = roundMoney(
          toMoney(doc.grand_total ?? doc.total_amount),
        );
        const paidAmount = roundMoney(toMoney(doc.paid_amount));
        const summary = allocationSummaries.get(doc.id);
        const allocatedAmount = resolveAllocatedAmount(
          summary?.allocated_amount ?? 0,
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
          allocation_source_doc_nos: summary?.source_doc_nos ?? [],
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

function resolvePaymentStatus(
  grandTotal: number,
  newPaidAmount: number,
): "UNPAID" | "PARTIAL" | "PAID" {
  if (newPaidAmount <= MONEY_EPS) return "UNPAID";
  if (newPaidAmount >= roundMoney(grandTotal) - MONEY_EPS) return "PAID";
  return "PARTIAL";
}

/** Lifecycle status: fully settled documents leave ISSUED → PAID. */
function resolveSettledDocumentStatus(
  paymentStatus: "UNPAID" | "PARTIAL" | "PAID",
): "ISSUED" | "PAID" {
  return paymentStatus === "PAID" ? "PAID" : "ISSUED";
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

/**
 * Knock-off payment (AR):
 * 1) Upload slip → Storage (optional)
 * 2) Create REC receipt document (+ attachment URL)
 * 3) Insert payment_transactions
 * 4) Insert document_allocations per invoice
 * 5) Update invoice paid_amount + payment_status
 */
export async function processPaymentKnockoff(
  formData: FormData,
): Promise<ProcessPaymentKnockoffResult> {
  const supabase = createSupabaseServerClient();
  let receiptDocId: string | null = null;
  let slipStoragePath: string | null = null;

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

    const numberResult = await generateDocumentNumber("REC", paymentDate);
    if (!numberResult.data) {
      return {
        success: false,
        error: numberResult.error ?? "สร้างเลขที่ใบเสร็จไม่สำเร็จ",
      };
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
    const nowIso = new Date().toISOString();
    const paymentDateIso = `${paymentDate}T00:00:00.000Z`;

    const owner = await requireSessionUserId();
    if (!owner.ok) {
      return { success: false, error: owner.error };
    }

    // 1) REC receipt document
    // grand_total = Total Invoices (ยอดหนี้เต็มที่ต้องการล้าง) — Phase 5
    // ไม่ใช่ Net Cash: มัดจำ / CN / WHT อยู่ที่ sub_total, paid_amount, allocations
    const { data: receipt, error: receiptError } = await supabase
      .from("documents")
      .insert({
        doc_no: numberResult.data,
        doc_type: "REC",
        status: "ISSUED",
        doc_date: paymentDate,
        contact_id: contactId,
        sub_total: netCashAmount,
        discount_amount: 0,
        tax_rate: 0,
        tax_amount: 0,
        wht_rate: 0,
        wht_amount: headerWht,
        grand_total: receiptGrandTotal,
        total_amount: netCashAmount,
        net_before_vat: netCashAmount,
        vat_amount: 0,
        vat_rate: 0,
        vat_type: "NONE",
        paid_amount: netCashAmount,
        payment_status: "PAID",
        attachment_url: slipUrl,
        attached_file_url: slipUrl,
        original_file_name:
          slipFile instanceof File && slipFile.size > 0
            ? slipFile.name.slice(0, 255)
            : null,
        notes: `AR Knock-off | invoices=${sumAllocated} | cash=${netCashAmount} | cn=${cnTotal} | deposit=${depositTotal} | wht=${headerWht}${referenceNo ? ` | ref=${referenceNo}` : ""}`,
        created_by: owner.userId,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (receiptError || !receipt) {
      if (slipStoragePath) {
        await supabase.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: receiptError?.message ?? "สร้างใบเสร็จรับเงิน (REC) ไม่สำเร็จ",
      };
    }

    receiptDocId = receipt.id as string;
    const receiptDocNo = String(receipt.doc_no);

    // 2) payment_transactions
    const { error: txError } = await supabase
      .from("payment_transactions")
      .insert({
        document_id: receiptDocId,
        payment_method: isCash ? "CASH" : "BANK_TRANSFER",
        bank_account_id: bankAccountId,
        amount: netCashAmount,
        reference_no: referenceNo,
        payment_date: paymentDateIso,
        attachment_url: slipUrl,
        is_reconciled: false,
        is_voided: false,
      });

    if (txError) {
      await supabase.from("documents").delete().eq("id", receiptDocId);
      if (slipStoragePath) {
        await supabase.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: txError.message ?? "บันทึก payment_transactions ไม่สำเร็จ",
      };
    }

    // 3) document_allocations — invoices + CN + deposits
    const allocationRows = [
      ...invoiceAllocations.map((row) => ({
        receipt_doc_id: receiptDocId,
        invoice_doc_id: row.invoice_id,
        allocated_amount: row.allocated_amount,
        wht_amount: row.wht_amount,
        adjustment_amount: 0,
        adjustment_reason: null as string | null,
      })),
      ...cnAllocations.map((row) => ({
        receipt_doc_id: receiptDocId,
        invoice_doc_id: row.invoice_id,
        allocated_amount: row.allocated_amount,
        wht_amount: 0,
        adjustment_amount: 0,
        adjustment_reason: "CN_APPLY",
      })),
      ...depositAllocations.map((row) => ({
        receipt_doc_id: receiptDocId,
        invoice_doc_id: row.deposit_id,
        allocated_amount: row.allocated_amount,
        wht_amount: 0,
        adjustment_amount: 0,
        adjustment_reason: "DEPOSIT_APPLY",
      })),
    ];

    const { error: allocError } = await supabase
      .from("document_allocations")
      .insert(allocationRows);

    if (allocError) {
      await supabase
        .from("payment_transactions")
        .delete()
        .eq("document_id", receiptDocId);
      await supabase.from("documents").delete().eq("id", receiptDocId);
      if (slipStoragePath) {
        await supabase.storage
          .from(DOCUMENT_ATTACHMENTS_BUCKET)
          .remove([slipStoragePath]);
      }
      return {
        success: false,
        error: allocError.message ?? "บันทึก document_allocations ไม่สำเร็จ",
      };
    }

    // 4) Update source invoices (paid_amount + payment_status + lifecycle status)
    const touchedInvoiceIds: string[] = [];
    for (const alloc of invoiceAllocations) {
      const invoice = invoiceMap.get(alloc.invoice_id)!;
      const grandTotal = toMoney(invoice.grand_total ?? invoice.total_amount);
      const prevPaid = toMoney(invoice.paid_amount);
      const apply = roundMoney(alloc.allocated_amount);
      const newPaid = roundMoney(prevPaid + apply);
      const nextPaymentStatus = resolvePaymentStatus(grandTotal, newPaid);
      const nextDocStatus = resolveSettledDocumentStatus(nextPaymentStatus);

      const { error: updateError } = await supabase
        .from("documents")
        .update({
          paid_amount: newPaid,
          payment_status: nextPaymentStatus,
          status: nextDocStatus,
          updated_at: nowIso,
        })
        .eq("id", alloc.invoice_id);

      if (updateError) {
        return {
          success: false,
          error: `บันทึกใบเสร็จ ${receiptDocNo} แล้ว แต่อัปเดตบิลต้นทางไม่สำเร็จ: ${updateError.message}`,
          receipt_doc_no: receiptDocNo,
        };
      }
      touchedInvoiceIds.push(alloc.invoice_id);
    }

    // 4b) Sync parent BN/BR payment_status (COMPLETED / PARTIAL)
    if (touchedInvoiceIds.length > 0) {
      const bnSync = await syncBillingNotesAfterInvoicePayment(
        supabase,
        touchedInvoiceIds,
      );
      if (bnSync.error) {
        return {
          success: false,
          error: `บันทึกใบเสร็จ ${receiptDocNo} แล้ว แต่อัปเดตสถานะใบวางบิลไม่สำเร็จ: ${bnSync.error}`,
          receipt_doc_no: receiptDocNo,
        };
      }
    }

    // 5) Update deposit_deducted on applied DEP_IN docs
    for (const alloc of depositAllocations) {
      const { data: depositRow, error: depositLoadError } = await supabase
        .from("documents")
        .select("id, deposit_deducted, grand_total, doc_no")
        .eq("id", alloc.deposit_id)
        .maybeSingle();

      if (depositLoadError || !depositRow) {
        return {
          success: false,
          error: `บันทึกใบเสร็จ ${receiptDocNo} แล้ว แต่อัปเดตมัดจำไม่สำเร็จ`,
          receipt_doc_no: receiptDocNo,
        };
      }

      const prevDeducted = toMoney(depositRow.deposit_deducted);
      const newDeducted = roundMoney(prevDeducted + alloc.allocated_amount);

      const { error: depositUpdateError } = await supabase
        .from("documents")
        .update({
          deposit_deducted: newDeducted,
          updated_at: nowIso,
        })
        .eq("id", alloc.deposit_id);

      if (depositUpdateError) {
        return {
          success: false,
          error: `บันทึกใบเสร็จ ${receiptDocNo} แล้ว แต่อัปเดตมัดจำไม่สำเร็จ: ${depositUpdateError.message}`,
          receipt_doc_no: receiptDocNo,
        };
      }

      // Best-effort mirror on doc_headers
      if (depositRow.doc_no) {
        await supabase
          .from("doc_headers")
          .update({ deposit_deducted: newDeducted })
          .eq("doc_no", depositRow.doc_no)
          .eq("doc_type", "DEP_IN");
      }
    }

    // 6) Update paid_amount on applied CN docs (full use → status PAID)
    const appliedCnDocs: Array<{
      id: string;
      doc_no: string;
      allocated_amount: number;
      previous_status: string;
      next_status: "ISSUED" | "PAID";
      next_payment_status: "UNPAID" | "PARTIAL" | "PAID";
    }> = [];

    for (const alloc of cnAllocations) {
      const creditNote = invoiceMap.get(alloc.invoice_id)!;
      const grandTotal = toMoney(
        creditNote.grand_total ?? creditNote.total_amount,
      );
      const prevPaid = toMoney(creditNote.paid_amount);
      const newPaid = roundMoney(prevPaid + alloc.allocated_amount);
      const nextPaymentStatus = resolvePaymentStatus(grandTotal, newPaid);
      const nextDocStatus = resolveSettledDocumentStatus(nextPaymentStatus);
      const cnDocNo = String(creditNote.doc_no ?? "").trim() || alloc.invoice_id;

      const { error: cnUpdateError } = await supabase
        .from("documents")
        .update({
          paid_amount: newPaid,
          payment_status: nextPaymentStatus,
          status: nextDocStatus,
          updated_at: nowIso,
        })
        .eq("id", alloc.invoice_id);

      if (cnUpdateError) {
        return {
          success: false,
          error: `บันทึกใบเสร็จ ${receiptDocNo} แล้ว แต่อัปเดตใบลดหนี้ไม่สำเร็จ: ${cnUpdateError.message}`,
          receipt_doc_no: receiptDocNo,
        };
      }

      appliedCnDocs.push({
        id: alloc.invoice_id,
        doc_no: cnDocNo,
        allocated_amount: alloc.allocated_amount,
        previous_status: String(creditNote.status ?? "ISSUED"),
        next_status: nextDocStatus,
        next_payment_status: nextPaymentStatus,
      });

      const cnAudit = await logAuditTrail(
        "documents",
        alloc.invoice_id,
        "UPDATE",
        {
          id: alloc.invoice_id,
          doc_no: cnDocNo,
          doc_type: "CN",
          status: creditNote.status ?? "ISSUED",
          payment_status: creditNote.payment_status ?? "UNPAID",
          paid_amount: prevPaid,
        },
        {
          audit_event: "CN_KNOCKOFF",
          id: alloc.invoice_id,
          doc_no: cnDocNo,
          doc_type: "CN",
          status: nextDocStatus,
          payment_status: nextPaymentStatus,
          paid_amount: newPaid,
          allocated_amount: alloc.allocated_amount,
          applied_on_receipt: receiptDocNo,
        },
      );
      if (!cnAudit.success) {
        console.error(
          "[processPaymentKnockoff][audit CN]",
          cnAudit.error,
        );
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
    if (receiptDocId) {
      await supabase
        .from("document_allocations")
        .delete()
        .eq("receipt_doc_id", receiptDocId);
      await supabase
        .from("payment_transactions")
        .delete()
        .eq("document_id", receiptDocId);
      await supabase.from("documents").delete().eq("id", receiptDocId);
    }
    if (slipStoragePath) {
      await supabase.storage
        .from(DOCUMENT_ATTACHMENTS_BUCKET)
        .remove([slipStoragePath]);
    }
    const message =
      err instanceof Error ? err.message : "ตัดยอดชำระเงินไม่สำเร็จ";
    return { success: false, error: message };
  }
}
