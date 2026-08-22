/**
 * Cash Purchase (non-installment) — auto PAY + knock-off on Issue/Approve.
 * No "use server" — imported by Server Actions only.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { generateDocumentNumber } from "@/lib/actions/document-actions";
import { encodeExpenseKnockoffReason } from "@/lib/utils/expense-knockoff";
import type { ExpenseCashSettlementResult } from "@/types/expense";

function toMoney(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

/**
 * When `is_installment === false`, create PAY + payment_transactions +
 * knock-off allocations, then mark expense PAID (Cash Purchase ERP flow).
 */
export async function settleExpenseCashPurchase(
  supabaseAdmin: SupabaseClient,
  expenseId: string,
): Promise<ExpenseCashSettlementResult> {
  const id = expenseId?.trim() ?? "";
  if (!id) {
    return { success: false, error: "ไม่พบรหัสเอกสารค่าใช้จ่าย" };
  }

  const { data: expense, error: expenseError } = await supabaseAdmin
    .from("expenses")
    .select(
      "id, document_no, expense_date, grand_total, vendor_id, vendor_doc_no, bank_account_id, payment_method, payment_slip_url, is_installment, status",
    )
    .eq("id", id)
    .maybeSingle();

  if (expenseError) {
    return { success: false, error: expenseError.message };
  }
  if (!expense) {
    return { success: false, error: "ไม่พบเอกสารค่าใช้จ่าย" };
  }

  if (Boolean(expense.is_installment)) {
    return { success: true, error: null, skipped: true };
  }

  const status = String(expense.status ?? "").toUpperCase();
  if (status === "PAID") {
    return { success: true, error: null, skipped: true };
  }
  if (status !== "ISSUED") {
    return {
      success: false,
      error: `บันทึกซื้อสดได้เฉพาะสถานะ ISSUED (ปัจจุบัน: ${expense.status})`,
    };
  }

  const amount = toMoney(expense.grand_total);
  if (!Number.isFinite(amount) || amount <= 0) {
    return { success: false, error: "ยอด Grand Total ไม่ถูกต้องสำหรับบันทึกซื้อสด" };
  }

  const paidDate = String(expense.expense_date ?? "").slice(0, 10);
  if (!isIsoDate(paidDate)) {
    return { success: false, error: "วันที่เอกสารไม่ถูกต้อง" };
  }

  const paymentMethodRaw = String(expense.payment_method ?? "")
    .trim()
    .toUpperCase();
  const bankAccountId =
    expense.bank_account_id == null
      ? null
      : String(expense.bank_account_id).trim() || null;
  const isCash =
    paymentMethodRaw === "CASH" ||
    paymentMethodRaw === "เงินสด" ||
    !bankAccountId;
  const slipUrl =
    expense.payment_slip_url == null
      ? null
      : String(expense.payment_slip_url).trim() || null;

  if (!isCash && bankAccountId) {
    const { data: bank, error: bankError } = await supabaseAdmin
      .from("mst_bank_accounts")
      .select("id")
      .eq("id", bankAccountId)
      .eq("is_active", true)
      .maybeSingle();

    if (bankError) {
      return { success: false, error: bankError.message };
    }
    if (!bank) {
      return { success: false, error: "ไม่พบสมุดบัญชีธนาคารของบิลค่าใช้จ่าย" };
    }
  }

  const numberResult = await generateDocumentNumber("PAY", paidDate);
  if (!numberResult.data) {
    return {
      success: false,
      error: numberResult.error ?? "สร้างเลขที่เอกสาร PAY ไม่สำเร็จ",
    };
  }

  const nowIso = new Date().toISOString();
  const paymentDateIso = `${paidDate}T00:00:00.000Z`;
  const expenseDocNo = String(expense.document_no ?? "").trim();
  const vendorDocNo =
    expense.vendor_doc_no == null
      ? null
      : String(expense.vendor_doc_no).trim() || null;
  const notes = `CASH_PURCHASE | Expense ${expenseDocNo}`;

  const { data: payDoc, error: payDocError } = await supabaseAdmin
    .from("documents")
    .insert({
      doc_no: numberResult.data,
      doc_type: "PAY",
      status: "COMPLETED",
      doc_date: paidDate,
      contact_id: expense.vendor_id,
      sub_total: amount,
      discount_amount: 0,
      tax_rate: 0,
      tax_amount: 0,
      wht_rate: 0,
      wht_amount: 0,
      grand_total: amount,
      total_amount: amount,
      net_before_vat: amount,
      vat_amount: 0,
      vat_rate: 0,
      vat_type: "NONE",
      paid_amount: amount,
      payment_status: "PAID",
      attachment_url: slipUrl,
      attached_file_url: slipUrl,
      notes,
      updated_at: nowIso,
    })
    .select("id")
    .single();

  if (payDocError || !payDoc) {
    return {
      success: false,
      error: payDocError?.message ?? "สร้างเอกสารจ่าย (PAY) ไม่สำเร็จ",
    };
  }

  const payDocId = String(payDoc.id);

  const { data: tx, error: txError } = await supabaseAdmin
    .from("payment_transactions")
    .insert({
      document_id: payDocId,
      payment_method: isCash ? "CASH" : "BANK_TRANSFER",
      bank_account_id: isCash ? null : bankAccountId,
      amount,
      reference_no: "CASH_PURCHASE",
      payment_date: paymentDateIso,
      attachment_url: slipUrl,
      is_reconciled: false,
      is_voided: false,
    })
    .select("id")
    .single();

  if (txError || !tx) {
    await supabaseAdmin.from("documents").delete().eq("id", payDocId);
    return {
      success: false,
      error: txError?.message ?? "บันทึก payment_transactions ไม่สำเร็จ",
    };
  }

  const txId = String(tx.id);
  const knockoffReason = encodeExpenseKnockoffReason({
    expense_id: id,
    document_no: expenseDocNo,
    vendor_doc_no: vendorDocNo,
  });

  async function rollbackSettlement(allocationIds: {
    documentAllocationId?: string | null;
    paymentAllocationId?: string | null;
  }) {
    if (allocationIds.paymentAllocationId) {
      await supabaseAdmin
        .from("payment_allocations")
        .delete()
        .eq("id", allocationIds.paymentAllocationId);
    }
    if (allocationIds.documentAllocationId) {
      await supabaseAdmin
        .from("document_allocations")
        .delete()
        .eq("id", allocationIds.documentAllocationId);
    }
    await supabaseAdmin.from("payment_transactions").delete().eq("id", txId);
    await supabaseAdmin.from("documents").delete().eq("id", payDocId);
  }

  const allocWithExpenseId = {
    receipt_doc_id: payDocId,
    invoice_doc_id: payDocId,
    allocated_amount: amount,
    wht_amount: 0,
    adjustment_amount: 0,
    adjustment_reason: knockoffReason,
    original_receipt_received: false,
    expense_id: id,
  };

  let { data: docAlloc, error: docAllocError } = await supabaseAdmin
    .from("document_allocations")
    .insert(allocWithExpenseId)
    .select("id")
    .single();

  if (docAllocError && /expense_id/i.test(docAllocError.message ?? "")) {
    const retry = await supabaseAdmin
      .from("document_allocations")
      .insert({
        receipt_doc_id: payDocId,
        invoice_doc_id: payDocId,
        allocated_amount: amount,
        wht_amount: 0,
        adjustment_amount: 0,
        adjustment_reason: knockoffReason,
        original_receipt_received: false,
      })
      .select("id")
      .single();
    docAlloc = retry.data;
    docAllocError = retry.error;
  }

  if (docAllocError || !docAlloc) {
    await rollbackSettlement({});
    return {
      success: false,
      error:
        docAllocError?.message ??
        "บันทึกการตัดยอด (document_allocations) ไม่สำเร็จ",
    };
  }

  const documentAllocationId = String(docAlloc.id);
  let paymentAllocationId: string | null = null;

  const { data: payAlloc, error: payAllocError } = await supabaseAdmin
    .from("payment_allocations")
    .insert({
      document_id: payDocId,
      expense_id: id,
      payment_transaction_id: txId,
      allocated_amount: amount,
    })
    .select("id")
    .single();

  if (payAllocError) {
    console.error(
      "[settleExpenseCashPurchase][payment_allocations]",
      payAllocError.message,
    );
  } else if (payAlloc) {
    paymentAllocationId = String(payAlloc.id);
  }

  const { data: paidRow, error: paidError } = await supabaseAdmin
    .from("expenses")
    .update({
      status: "PAID",
      updated_at: nowIso,
    })
    .eq("id", id)
    .eq("status", "ISSUED")
    .select("id")
    .maybeSingle();

  if (paidError || !paidRow) {
    await rollbackSettlement({
      documentAllocationId,
      paymentAllocationId,
    });
    return {
      success: false,
      error:
        paidError?.message ??
        "อัปเดตสถานะเป็น PAID ไม่สำเร็จ (อาจถูกแก้ไขไปแล้ว)",
    };
  }

  return { success: true, error: null, skipped: false };
}
