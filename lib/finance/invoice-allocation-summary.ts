/**
 * Invoice allocation totals from `document_allocations`.
 * There is no `ref_document_no` column — source docs come from
 * `receipt_doc_id` → `documents.doc_no` (explicit FK).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { roundMoney } from "@/lib/utils/payment-fifo";

export type InvoiceAllocationSummary = {
  allocated_amount: number;
  source_doc_nos: string[];
};

type ReceiptJoin = {
  doc_no?: string | null;
};

type AllocationRow = {
  invoice_doc_id: string | null;
  allocated_amount: number | string | null;
  documents: ReceiptJoin | ReceiptJoin[] | null;
};

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function unwrapOne<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

/**
 * Σ allocated_amount per invoice + unique receipt document numbers.
 */
export async function loadInvoiceAllocationSummaries(
  supabaseAdmin: SupabaseClient,
  invoiceIds: string[],
): Promise<Map<string, InvoiceAllocationSummary>> {
  const summaries = new Map<string, InvoiceAllocationSummary>();
  const uniqueIds = [
    ...new Set(invoiceIds.map((id) => id.trim()).filter(Boolean)),
  ];
  for (const id of uniqueIds) {
    summaries.set(id, { allocated_amount: 0, source_doc_nos: [] });
  }
  if (uniqueIds.length === 0) return summaries;

  const { data, error } = await supabaseAdmin
    .from("document_allocations")
    .select(
      `
      invoice_doc_id,
      allocated_amount,
      documents!document_allocations_receipt_doc_id_fkey (
        doc_no
      )
    `,
    )
    .in("invoice_doc_id", uniqueIds);

  if (error) {
    console.error(
      "[loadInvoiceAllocationSummaries]",
      error.message,
    );
    return summaries;
  }

  for (const row of (data ?? []) as AllocationRow[]) {
    const invoiceId = String(row.invoice_doc_id ?? "").trim();
    if (!invoiceId) continue;

    const current = summaries.get(invoiceId) ?? {
      allocated_amount: 0,
      source_doc_nos: [],
    };
    current.allocated_amount = roundMoney(
      current.allocated_amount + toMoney(row.allocated_amount),
    );

    const receipt = unwrapOne(row.documents);
    const docNo = receipt?.doc_no?.trim() || "";
    if (docNo && !current.source_doc_nos.includes(docNo)) {
      current.source_doc_nos.push(docNo);
    }
    summaries.set(invoiceId, current);
  }

  return summaries;
}

export function resolveAllocatedAmount(
  ledgerAllocated: number,
  paidAmount: number,
): number {
  if (ledgerAllocated > 0.02) return roundMoney(ledgerAllocated);
  return roundMoney(Math.max(0, paidAmount));
}
