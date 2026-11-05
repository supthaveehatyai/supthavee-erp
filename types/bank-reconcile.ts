export type MatchedStatementDocument = {
  document_id: string;
  doc_no: string;
  doc_type: string;
  doc_date: string;
  customer_name: string;
  handwritten_doc_ref: string;
  reference_no: string;
  grand_total: number;
  deposit_deducted: number;
  wht_amount: number;
  allocated_amount: number;
  parent_doc_no: string | null;
};

export type BankStatementLineView = {
  id: string;
  tx_date: string;
  tx_time: string;
  tx_code: string;
  description: string;
  payer_hint: string;
  withdrawal_amount: number;
  deposit_amount: number;
  balance_amount: number | null;
  tx_direction: "IN" | "OUT" | string;
  expense_memo: string;
  reconcile_status: "UNMATCHED" | "PARTIAL" | "MATCHED" | string;
  matched_amount: number;
  /** Line-level amount already tied, from `get_statement_lines_with_matches`. */
  allocated_amount: number;
  allocated_total: number;
  matched_doc_nos: string;
  matched_documents: MatchedStatementDocument[];
};

export type ParsedKtbLine = {
  tx_date: string;
  tx_time: string;
  tx_code: string;
  description: string;
  payer_hint: string;
  withdrawal_amount: number;
  deposit_amount: number;
  balance_amount: number | null;
  tx_direction: "IN" | "OUT";
  row_hash: string;
};

export type ImportKtbStatementResult = {
  data: {
    inserted: number;
    skipped: number;
    account_no: string | null;
  } | null;
  error: string | null;
};

export type ListBankLinesResult = {
  data: BankStatementLineView[];
  error: string | null;
};

export type OpenSalesBill = {
  id: string;
  doc_no: string;
  doc_type: string;
  doc_date: string;
  sales_channel: string | null;
  customer_label: string | null;
  grand_total: number;
  paid_amount: number;
  outstanding: number;
  deposit_deducted: number;
  wht_amount: number;
  /** Amount still available to tie to a bank line (`reconcilable_amount`). */
  linkable_amount: number;
  payment_status: string;
  created_at: string;
  reference_no: string;
  /** Bills on the same date with the same reconcilable amount. */
  same_amount_count: number;
};

export type BillMatchSuggestion = OpenSalesBill & {
  reason: string;
  suggested_amount: number;
  suggested_fee: number;
};

export type SuggestBillMatchesResult = {
  data: BillMatchSuggestion[];
  error: string | null;
};

export type SearchOpenBillsInput = {
  keyword?: string;
  tx_date?: string;
  sales_channel?: string | null;
  /** Bank line text, used to rank a matching slip reference first. */
  description?: string | null;
};

export type AutoMatchUniqueResult = {
  data: { matched: number; skipped: number; errors: string[] } | null;
  error: string | null;
};

export type ReclassifyPaymentChannelInput = {
  document_id: string;
  payment_channel: "CASH" | "OTHER_BANK";
  bank_account_id?: string | null;
};

export type SearchOpenBillsResult = {
  data: OpenSalesBill[];
  error: string | null;
};

export type BankMatchAllocationInput = {
  document_id: string;
  allocated_amount: number;
};

export type ConfirmBankMatchInput = {
  statement_line_id: string;
  allocations: BankMatchAllocationInput[];
  platform_fee_diff: number;
};

export type ConfirmWithdrawalInput = {
  statement_line_id: string;
  allocations: BankMatchAllocationInput[];
  expense_memo?: string | null;
};

export type ConfirmBankMatchResult = {
  data: {
    reconcile_status: string;
    matched_amount: number;
    warnings: string[];
  } | null;
  error: string | null;
};
