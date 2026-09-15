/**
 * Refund Maker-Checker settlement helpers.
 * Schema: `documents`, `document_allocations` (receipt_doc_id / invoice_doc_id),
 * `payment_transactions`.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isRefundDocType } from "@/lib/constants/document";
import { roundMoney } from "@/lib/utils/payment-fifo";

const MONEY_EPS = 0.02;

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * เมื่อปฏิเสธใบ Refund: คืนยอดมัดจำ ลบ allocations และ payment_transactions
 * เอกสาร Refund คงสถานะ DRAFT + REJECTED (ไม่ลบ header)
 */
export async function reverseRefundSettlementOnReject(
  supabaseAdmin: SupabaseClient,
  refundId: string,
): Promise<{ error: string | null }> {
  const id = refundId.trim();
  if (!id) return { error: "ไม่พบรหัสเอกสารคืนเงิน" };

  const { data: header, error: headerError } = await supabaseAdmin
    .from("documents")
    .select("id, doc_type, ref_document_id")
    .eq("id", id)
    .maybeSingle();

  if (headerError) return { error: headerError.message };
  if (!header || !isRefundDocType(String(header.doc_type ?? ""))) {
    return { error: null };
  }

  const { data: allocations, error: allocError } = await supabaseAdmin
    .from("document_allocations")
    .select("invoice_doc_id, allocated_amount")
    .eq("receipt_doc_id", id);

  if (allocError) return { error: allocError.message };

  const nowIso = new Date().toISOString();
  const byDeposit = new Map<string, number>();
  for (const row of allocations ?? []) {
    const depositId = String(row.invoice_doc_id ?? "").trim();
    if (!depositId) continue;
    byDeposit.set(
      depositId,
      roundMoney((byDeposit.get(depositId) ?? 0) + toMoney(row.allocated_amount)),
    );
  }

  const fallbackDeposit = String(header.ref_document_id ?? "").trim();
  if (byDeposit.size === 0 && fallbackDeposit) {
    byDeposit.set(fallbackDeposit, 0);
  }

  for (const [depositId, allocated] of byDeposit) {
    const { data: deposit, error: depositError } = await supabaseAdmin
      .from("documents")
      .select("id, deposit_deducted")
      .eq("id", depositId)
      .maybeSingle();

    if (depositError) return { error: depositError.message };
    if (!deposit) continue;

    const nextDeducted = roundMoney(
      Math.max(0, toMoney(deposit.deposit_deducted) - allocated),
    );
    const { error: updateError } = await supabaseAdmin
      .from("documents")
      .update({
        deposit_deducted: nextDeducted <= MONEY_EPS ? 0 : nextDeducted,
        updated_at: nowIso,
      })
      .eq("id", depositId);

    if (updateError) return { error: updateError.message };
  }

  const { error: deleteAllocError } = await supabaseAdmin
    .from("document_allocations")
    .delete()
    .eq("receipt_doc_id", id);
  if (deleteAllocError) return { error: deleteAllocError.message };

  const { error: deleteTxError } = await supabaseAdmin
    .from("payment_transactions")
    .delete()
    .eq("document_id", id);
  if (deleteTxError) return { error: deleteTxError.message };

  return { error: null };
}
