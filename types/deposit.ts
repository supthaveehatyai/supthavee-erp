/**
 * Phase 5 — Deposit Management types (shared by Server Actions + UI).
 * Kept outside `"use server"` modules — Next.js only allows async function
 * exports from Server Action files.
 */

export type DepositTab = "DEP_IN" | "DEP_OUT";

export type DepositDocument = {
  id: string;
  /** Document date (YYYY-MM-DD) — maps from `documents.doc_date`. */
  document_date: string;
  doc_no: string;
  contact_id: string;
  contact_name: string;
  grand_total: number;
  /** Sum of document_allocations.allocated_amount where invoice_doc_id = deposit. */
  allocated_amount: number;
  /** Remaining usable balance = grand_total − allocated_amount. */
  available_amount: number;
  deposit_deducted: number;
  /** Human-readable allocation status for the dashboard. */
  status_label: string;
  payment_status: string;
  created_at: string;
};

export type GetDepositDocumentsResult = {
  data: DepositDocument[];
  error: string | null;
};

export type CreateDepositDocumentResult = {
  success: boolean;
  error: string | null;
  doc_no?: string | null;
  doc_type?: DepositTab | null;
};

/** Deposit balance settlement actions. */
export type DepositBalanceActionType = "REFUND" | "WRITE_OFF";

export type ManageDepositBalanceResult = {
  success: boolean;
  error: string | null;
  /** Running number of the stub REFUND / WRITE_OFF document. */
  action_doc_no?: string | null;
  pending_approval?: boolean;
  successMessage?: string;
};
