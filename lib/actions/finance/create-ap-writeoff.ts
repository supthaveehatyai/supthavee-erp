"use server";

/**
 * Compatibility adapters — canonical AP Write-off actions live in
 * `@/app/actions/ap-writeoff` (`getOutstandingAP`, `createAPWriteOff`).
 */

import { getOutstandingAP, createAPWriteOff } from "@/app/actions/ap-writeoff";
import { roundMoney } from "@/lib/utils/payment-fifo";
import type { ApVendorOption } from "@/types/ap-payment";
import type { CreateApWriteoffResult } from "@/types/ap-writeoff";
import type { UnpaidInvoice } from "@/types/payment";

export async function getApWriteoffVendors(): Promise<ApVendorOption[]> {
  const result = await getOutstandingAP();
  if (!result.success) return [];

  const grouped = new Map<
    string,
    {
      name: string;
      outstanding_total: number;
      invoice_count: number;
      oldest_invoice_date: string | null;
    }
  >();

  for (const row of result.data) {
    const existing = grouped.get(row.contact_id);
    if (!existing) {
      grouped.set(row.contact_id, {
        name: row.contact_name,
        outstanding_total: row.remaining_balance,
        invoice_count: 1,
        oldest_invoice_date: row.doc_date || null,
      });
      continue;
    }
    existing.outstanding_total = roundMoney(
      existing.outstanding_total + row.remaining_balance,
    );
    existing.invoice_count += 1;
    if (
      row.doc_date &&
      (!existing.oldest_invoice_date ||
        row.doc_date < existing.oldest_invoice_date)
    ) {
      existing.oldest_invoice_date = row.doc_date;
    }
  }

  return Array.from(grouped.entries())
    .map(([id, row]) => ({
      id,
      name: row.name,
      outstanding_total: row.outstanding_total,
      invoice_count: row.invoice_count,
      overdue_amount: 0,
      oldest_invoice_date: row.oldest_invoice_date,
    }))
    .sort((a, b) => b.outstanding_total - a.outstanding_total);
}

export async function getUnpaidApInvoicesByVendor(
  contactId: string,
): Promise<UnpaidInvoice[]> {
  const trimmed = contactId?.trim() ?? "";
  if (!trimmed) return [];

  const result = await getOutstandingAP();
  if (!result.success) return [];

  return result.data
    .filter((row) => row.contact_id === trimmed)
    .map((row) => ({
      id: row.id,
      display_doc_no: row.doc_no,
      document_date: row.doc_date,
      doc_type: row.doc_type,
      payment_status: row.payment_status,
      grand_total: row.grand_total,
      net_amount_calc: row.grand_total,
      paid_amount: row.allocated_amount,
      allocated_amount: row.allocated_amount,
      allocation_source_doc_nos: [],
      remaining_balance: row.remaining_balance,
      contact_id: row.contact_id,
    }));
}

export async function createApWriteOff(
  payload: unknown,
): Promise<CreateApWriteoffResult> {
  const result = await createAPWriteOff(payload);
  if (!result.success || !result.data) {
    return { success: false, error: result.error };
  }

  return {
    success: true,
    error: null,
    document_id: result.data.document_id,
    document_no: result.data.document_no,
    grand_total: result.data.grand_total,
    settled_invoice_ids: result.data.settled_invoice_ids,
    pending_approval: result.data.pending_approval,
  };
}
