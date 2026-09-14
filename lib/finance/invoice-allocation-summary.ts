/**
 * Invoice allocation lines from `document_allocations`.
 * Schema has `allocated_amount` (no `amount` / `ref_document_no`).
 * Source document = `receipt_doc_id` → `documents` via explicit FK.
 */

import type { InvoiceAllocationSource } from "@/types/payment";
import { roundMoney } from "@/lib/utils/payment-fifo";

export type NestedReceiptDocument = {
  doc_no?: string | null;
  doc_type?: string | null;
};

export type NestedAllocationRow = {
  allocated_amount?: number | string | null;
  receipt_document?: NestedReceiptDocument | NestedReceiptDocument[] | null;
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
 * Nested PostgREST embed from `documents` → allocations on this invoice.
 * `allocated_amount` is the real column (not `amount`).
 */
export const OUTSTANDING_ALLOCATION_EMBED = `
  allocations:document_allocations!document_allocations_invoice_doc_id_fkey (
    allocated_amount,
    receipt_document:documents!document_allocations_receipt_doc_id_fkey (
      doc_no,
      doc_type
    )
  )
`;

export function mapAllocationSources(
  rows: NestedAllocationRow[] | NestedAllocationRow | null | undefined,
): InvoiceAllocationSource[] {
  const list = Array.isArray(rows) ? rows : rows ? [rows] : [];
  const sources: InvoiceAllocationSource[] = [];
  for (const row of list) {
    const amount = roundMoney(toMoney(row.allocated_amount));
    if (amount <= 0) continue;
    const receipt = unwrapOne(row.receipt_document);
    const docNo = receipt?.doc_no?.trim() || "—";
    const docType = String(receipt?.doc_type ?? "").trim();
    sources.push({
      doc_no: docNo,
      amount,
      doc_type: docType,
    });
  }
  return sources;
}

export function sumAllocationSources(
  sources: InvoiceAllocationSource[],
): number {
  return roundMoney(
    sources.reduce((sum, row) => sum + toMoney(row.amount), 0),
  );
}

export function resolveAllocatedAmount(
  ledgerAllocated: number,
  paidAmount: number,
): number {
  if (ledgerAllocated > 0.02) return roundMoney(ledgerAllocated);
  return roundMoney(Math.max(0, paidAmount));
}
