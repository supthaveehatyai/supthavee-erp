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
  reconcile_status: "UNMATCHED" | "PARTIAL" | "MATCHED" | string;
  matched_amount: number;
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
  /** Amount still available to tie to a bank line. */
  linkable_amount: number;
  payment_status: string;
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

export type ConfirmBankMatchResult = {
  data: {
    reconcile_status: string;
    matched_amount: number;
    warnings: string[];
  } | null;
  error: string | null;
};
