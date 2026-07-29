"use server";

/**
 * Phase 5 — Receive Payment Server Actions.
 * Zero Client-Side Fetching: Service Role via `createSupabaseServerClient` only.
 */

import { revalidatePath } from "next/cache";
import { generateDocumentNumber } from "@/lib/actions/document-actions";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type {
  DebtorOption,
  KnockoffAllocationInput,
  ProcessPaymentKnockoffResult,
  UnpaidInvoice,
} from "@/types/payment";

const OPEN_PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "Pending"] as const;
const AR_DOC_TYPES = ["INV_DO", "TAX_INV"] as const;

type ContactJoin = {
  id?: string;
  company_name?: string | null;
};

type DebtorDocRow = {
  contact_id: string | null;
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

/** Dropdown: unique customers with open AR invoices. */
export async function getDebtorsList(): Promise<DebtorOption[]> {
  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("documents")
      .select(
        `
        contact_id,
        contacts:contact_id (
          id,
          company_name
        )
      `,
      )
      .in("payment_status", [...OPEN_PAYMENT_STATUSES])
      .in("doc_type", [...AR_DOC_TYPES])
      .in("status", ["ISSUED", "COMPLETED"])
      .or("is_voided.is.null,is_voided.eq.false");

    if (error) {
      console.error("Error fetching debtors:", error.message);
      return [];
    }

    const uniqueDebtors = new Map<string, DebtorOption>();

    for (const doc of (data ?? []) as DebtorDocRow[]) {
      const contact = unwrapContact(doc.contacts);
      const contactId = doc.contact_id?.trim() || contact?.id || "";
      if (!contactId || uniqueDebtors.has(contactId)) continue;

      uniqueDebtors.set(contactId, {
        id: contactId,
        name: contact?.company_name?.trim() || "ไม่ระบุชื่อ",
      });
    }

    return Array.from(uniqueDebtors.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "th"),
    );
  } catch (err) {
    console.error("Error fetching debtors:", err);
    return [];
  }
}

/** Unpaid invoices for one customer (`contact_id` from URL). */
export async function getUnpaidInvoicesByCustomer(
  contactId: string,
): Promise<UnpaidInvoice[]> {
  const trimmed = contactId?.trim() ?? "";
  if (!trimmed) return [];

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
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
      .in("doc_type", [...AR_DOC_TYPES])
      .in("status", ["ISSUED", "COMPLETED"])
      .or("is_voided.is.null,is_voided.eq.false")
      .order("doc_date", { ascending: true });

    if (error) {
      console.error("Error fetching invoices for customer:", error.message);
      return [];
    }

    return ((data ?? []) as InvoiceDocRow[])
      .map((doc) => {
        const netAmount = toMoney(doc.grand_total ?? doc.total_amount);
        const paidAmount = toMoney(doc.paid_amount);
        const remaining = netAmount - paidAmount;

        return {
          id: doc.id,
          display_doc_no: doc.doc_no?.trim() || "ไม่ระบุ",
          document_date: doc.doc_date ? String(doc.doc_date) : "",
          doc_type: doc.doc_type ?? "",
          payment_status: String(doc.payment_status ?? "UNPAID"),
          net_amount_calc: netAmount,
          paid_amount: paidAmount,
          remaining_balance: remaining,
          contact_id: doc.contact_id ?? trimmed,
        } satisfies UnpaidInvoice;
      })
      .filter((inv) => inv.remaining_balance > 0);
  } catch (err) {
    console.error("Error fetching invoices for customer:", err);
    return [];
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

function resolvePaymentStatus(
  grandTotal: number,
  newPaidAmount: number,
): "UNPAID" | "PARTIAL" | "PAID" {
  if (newPaidAmount <= MONEY_EPS) return "UNPAID";
  if (newPaidAmount >= roundMoney(grandTotal) - MONEY_EPS) return "PAID";
  return "PARTIAL";
}

/**
 * Knock-off payment:
 * 1) Create REC receipt document
 * 2) Insert payment_transactions
 * 3) Insert document_allocations per invoice
 * 4) Update invoice paid_amount + payment_status
 */
export async function processPaymentKnockoff(
  formData: FormData,
): Promise<ProcessPaymentKnockoffResult> {
  const supabase = createSupabaseServerClient();
  let receiptDocId: string | null = null;

  try {
    const contactId = String(formData.get("contact_id") ?? "").trim();
    const bankAccountId = String(formData.get("bank_account_id") ?? "").trim();
    const referenceNo =
      String(formData.get("reference_no") ?? "").trim() || null;
    const cashAmount = roundMoney(Number(formData.get("amount") ?? 0));
    const headerWht = roundMoney(Number(formData.get("wht_amount") ?? 0));
    const allocations = parseAllocationsJson(formData.get("allocations_json"));

    if (!contactId) {
      return { success: false, error: "ไม่พบรหัสลูกค้า" };
    }
    if (!bankAccountId) {
      return { success: false, error: "กรุณาเลือกสมุดบัญชีธนาคาร" };
    }
    if (cashAmount < 0 || headerWht < 0) {
      return { success: false, error: "ยอดเงินต้องไม่ติดลบ" };
    }
    if (cashAmount <= 0 && headerWht <= 0) {
      return { success: false, error: "กรุณาระบุยอดเงินโอนหรือ WHT" };
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

    const sumAllocated = roundMoney(
      activeAllocations.reduce((sum, row) => sum + row.allocated_amount, 0),
    );
    const sumWht = roundMoney(
      activeAllocations.reduce((sum, row) => sum + row.wht_amount, 0),
    );

    if (Math.abs(sumAllocated - cashAmount) > MONEY_EPS) {
      return {
        success: false,
        error: `ยอด Allocated รวม (${sumAllocated.toFixed(2)}) ไม่ตรงกับยอดโอนจริง (${cashAmount.toFixed(2)})`,
      };
    }
    if (Math.abs(sumWht - headerWht) > MONEY_EPS) {
      return {
        success: false,
        error: `ยอด WHT รวมในบิล (${sumWht.toFixed(2)}) ไม่ตรงกับยอด WHT ส่วนหัว (${headerWht.toFixed(2)})`,
      };
    }

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

    const invoiceIds = activeAllocations.map((row) => row.invoice_id);
    const { data: invoices, error: invoicesError } = await supabase
      .from("documents")
      .select("id, contact_id, grand_total, total_amount, paid_amount, payment_status, doc_type, status, is_voided")
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
      if (!AR_DOC_TYPES.includes(invoice.doc_type as (typeof AR_DOC_TYPES)[number])) {
        return {
          success: false,
          error: `ประเภทเอกสารไม่รองรับการตัดหนี้: ${invoice.doc_type}`,
        };
      }

      const grandTotal = toMoney(invoice.grand_total ?? invoice.total_amount);
      const paidAmount = toMoney(invoice.paid_amount);
      const remaining = roundMoney(grandTotal - paidAmount);
      const apply = roundMoney(alloc.allocated_amount + alloc.wht_amount);

      if (apply > remaining + MONEY_EPS) {
        return {
          success: false,
          error: `ยอดตัดหนี้เกินยอดค้างของบิล (เหลือ ${remaining.toFixed(2)})`,
        };
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const numberResult = await generateDocumentNumber("REC", today);
    if (!numberResult.data) {
      return {
        success: false,
        error: numberResult.error ?? "สร้างเลขที่ใบเสร็จไม่สำเร็จ",
      };
    }

    const receiptGrandTotal = roundMoney(cashAmount + headerWht);
    const nowIso = new Date().toISOString();

    // 1) REC receipt document
    const { data: receipt, error: receiptError } = await supabase
      .from("documents")
      .insert({
        doc_no: numberResult.data,
        doc_type: "REC",
        status: "ISSUED",
        doc_date: today,
        contact_id: contactId,
        sub_total: cashAmount,
        discount_amount: 0,
        tax_rate: 0,
        tax_amount: 0,
        wht_rate: 0,
        wht_amount: headerWht,
        grand_total: receiptGrandTotal,
        total_amount: cashAmount,
        net_before_vat: cashAmount,
        vat_amount: 0,
        vat_rate: 0,
        vat_type: "NONE",
        paid_amount: cashAmount,
        payment_status: "PAID",
        notes: `AR Knock-off | cash=${cashAmount} | wht=${headerWht}`,
        updated_at: nowIso,
      })
      .select("id, doc_no")
      .single();

    if (receiptError || !receipt) {
      return {
        success: false,
        error: receiptError?.message ?? "สร้างใบเสร็จรับเงิน (REC) ไม่สำเร็จ",
      };
    }

    receiptDocId = receipt.id as string;
    const receiptDocNo = String(receipt.doc_no);

    // 2) payment_transactions
    const { error: txError } = await supabase.from("payment_transactions").insert({
      document_id: receiptDocId,
      payment_method: "BANK_TRANSFER",
      bank_account_id: bankAccountId,
      amount: cashAmount,
      reference_no: referenceNo,
      payment_date: nowIso,
      is_reconciled: false,
      is_voided: false,
    });

    if (txError) {
      await supabase.from("documents").delete().eq("id", receiptDocId);
      return {
        success: false,
        error: txError.message ?? "บันทึก payment_transactions ไม่สำเร็จ",
      };
    }

    // 3) document_allocations
    const allocationRows = activeAllocations.map((row) => ({
      receipt_doc_id: receiptDocId,
      invoice_doc_id: row.invoice_id,
      allocated_amount: row.allocated_amount,
      wht_amount: row.wht_amount,
      adjustment_amount: 0,
    }));

    const { error: allocError } = await supabase
      .from("document_allocations")
      .insert(allocationRows);

    if (allocError) {
      await supabase.from("payment_transactions").delete().eq("document_id", receiptDocId);
      await supabase.from("documents").delete().eq("id", receiptDocId);
      return {
        success: false,
        error: allocError.message ?? "บันทึก document_allocations ไม่สำเร็จ",
      };
    }

    // 4) Update source invoices
    for (const alloc of activeAllocations) {
      const invoice = invoiceMap.get(alloc.invoice_id)!;
      const grandTotal = toMoney(invoice.grand_total ?? invoice.total_amount);
      const prevPaid = toMoney(invoice.paid_amount);
      const apply = roundMoney(alloc.allocated_amount + alloc.wht_amount);
      const newPaid = roundMoney(prevPaid + apply);
      const nextStatus = resolvePaymentStatus(grandTotal, newPaid);

      const { error: updateError } = await supabase
        .from("documents")
        .update({
          paid_amount: newPaid,
          payment_status: nextStatus,
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
    }

    revalidatePath("/finance/payments");
    revalidatePath("/finance/ap-ar");

    return {
      success: true,
      error: null,
      receipt_doc_no: receiptDocNo,
    };
  } catch (err) {
    if (receiptDocId) {
      await supabase.from("document_allocations").delete().eq("receipt_doc_id", receiptDocId);
      await supabase.from("payment_transactions").delete().eq("document_id", receiptDocId);
      await supabase.from("documents").delete().eq("id", receiptDocId);
    }
    const message =
      err instanceof Error ? err.message : "ตัดยอดชำระเงินไม่สำเร็จ";
    return { success: false, error: message };
  }
}
