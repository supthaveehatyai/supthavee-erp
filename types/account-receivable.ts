/**
 * Phase 5 — AR / AP ledger group types.
 */

export type ArDocument = {
  id: string;
  doc_no: string;
  doc_date: string;
  due_date: string | null;
  doc_type: string;
  grand_total: number;
  paid_amount: number;
  remaining_balance: number;
  payment_status: string;
  contact_id: string;
};

export type AccountReceivableGroup = {
  contact_id: string;
  contact_name: string;
  total_invoices: number;
  total_debt: number;
  total_paid: number;
  remaining_balance: number;
  documents: ArDocument[];
};

export type GetAccountReceivablesResult = {
  data: AccountReceivableGroup[];
  error: string | null;
};

/** Same shape as AR — grouped by vendor for AP. */
export type AccountPayableGroup = AccountReceivableGroup;
export type ApDocument = ArDocument;

export type GetAccountPayablesResult = {
  data: AccountPayableGroup[];
  error: string | null;
};
