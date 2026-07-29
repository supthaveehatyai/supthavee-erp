/**
 * Phase 5 — AP Payment / outstanding purchase invoices.
 * Kept outside `"use server"` modules.
 */

export type ApVendorOption = {
  id: string;
  name: string;
  /** Sum of remaining balances across open AP invoices (> 0 only). */
  outstanding_total: number;
  invoice_count: number;
  /** Remaining amount on invoices past due (Server-calculated). */
  overdue_amount: number;
  /** Oldest open invoice document_date (YYYY-MM-DD). */
  oldest_invoice_date: string | null;
};

/** Outstanding AP invoice row from Phase 4/5 `documents` (FIFO-ready). */
export type OutstandingApInvoice = {
  id: string;
  contact_id: string;
  /** Internal running number (`documents.doc_no`) — used for routing. */
  document_no: string;
  /** Vendor invoice number parsed from `notes` (no DB column yet). */
  reference_no: string | null;
  document_date: string;
  grand_total: number;
  paid_amount: number;
  remaining_balance: number;
  payment_status: string;
  doc_type: string;
};

export type ApAllocationInput = {
  invoice_id: string;
  allocated_amount: number;
};

export type SubmitAPPaymentResult = {
  success: boolean;
  error: string | null;
  payment_doc_no?: string | null;
};
