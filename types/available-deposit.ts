/**
 * Available deposit balances for AR/AP knock-off.
 * Kept outside `"use server"` modules.
 */

export type AvailableDeposit = {
  id: string;
  doc_no: string;
  document_date: string;
  doc_type: "DEP_IN" | "DEP_OUT";
  grand_total: number;
  /** Amount already applied via document_allocations (invoice_doc_id = deposit). */
  used_amount: number;
  remaining_balance: number;
  contact_id: string;
};

export type DepositAllocationInput = {
  deposit_id: string;
  allocated_amount: number;
};
