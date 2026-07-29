/**
 * Phase 5 — Payment / debtor list types.
 * Kept outside `"use server"` modules.
 */

export type DebtorOption = {
  id: string;
  name: string;
};

export type UnpaidInvoice = {
  id: string;
  display_doc_no: string;
  document_date: string;
  doc_type: string;
  payment_status: string;
  net_amount_calc: number;
  paid_amount: number;
  remaining_balance: number;
  contact_id: string;
};

export type KnockoffAllocationInput = {
  invoice_id: string;
  allocated_amount: number;
  wht_amount: number;
};

export type ProcessPaymentKnockoffResult = {
  success: boolean;
  error: string | null;
  receipt_doc_no?: string | null;
};
