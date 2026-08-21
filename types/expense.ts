/**
 * Phase 8 — Expense Management types (shared by Server Actions + UI).
 * Kept outside `"use server"` modules — Next.js only allows async function
 * exports from Server Action files.
 */

export type ExpenseCategory = {
  id: string;
  category_name: string;
  description: string | null;
  is_active: boolean;
  created_at: string;
};

export type ExpenseRecord = {
  id: string;
  document_no: string;
  expense_date: string;
  category_id: string | null;
  vendor_id: string | null;
  /** Vendor bill no. from receipt (OCR) — used for duplicate prevention. */
  vendor_doc_no: string | null;
  bank_account_id: string | null;
  net_amount: number;
  vat_amount: number;
  grand_total: number;
  /** WHT category label (e.g. ค่าบริการ). */
  wht_type: string | null;
  /** WHT rate percent. */
  wht_rate: number;
  /** WHT amount withheld. */
  wht_amount: number;
  /** Cash payable: grand_total - wht_amount. */
  net_payable: number;
  payment_method: string | null;
  receipt_url: string | null;
  /** Optional bank transfer slip URL (expense_documents / SLIP-*). */
  payment_slip_url: string | null;
  status: "DRAFT" | "ISSUED" | "VOID" | string;
  /** Maker-Checker — PENDING | APPROVED | REJECTED */
  approval_status: "PENDING" | "APPROVED" | "REJECTED" | string;
  remark: string | null;
  recorded_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ExpenseDetail = ExpenseRecord & {
  category_name: string;
  vendor_name: string;
  bank_account_label: string | null;
};

export type GetExpenseByIdResult = {
  data: ExpenseDetail | null;
  error: string | null;
};

export type MutateExpenseResult = {
  data: ExpenseRecord | null;
  /** Error code (e.g. DUPLICATE_INVOICE) or human-readable message. */
  error: string | null;
  /** Human-readable detail when `error` is a machine code. */
  message?: string | null;
  /** True when expense entered Maker-Checker queue (grand_total > threshold). */
  pending_approval?: boolean;
  /** Toast override for IssueDocumentButton wrappers. */
  successMessage?: string;
};

export type ExpenseVendorOption = {
  id: string;
  company_name: string;
};

export type CreateDraftExpenseInput = {
  category_id: string;
  vendor_id: string;
  expense_date: string;
  net_amount: number;
  vat_amount?: number;
  remark?: string | null;
  payment_method?: string | null;
  bank_account_id?: string | null;
  /** Vendor bill number from receipt — maps to expenses.vendor_doc_no */
  vendor_doc_no?: string | null;
  wht_type?: string | null;
  wht_rate?: number;
  wht_amount?: number;
  /** Optional — Server Action recomputes/verifies as grand_total - wht_amount */
  net_payable?: number;
  /** Public URL from `uploadExpenseReceipt` → expenses.receipt_url */
  receipt_url?: string | null;
  /** Public URL from payment slip upload → expenses.payment_slip_url */
  payment_slip_url?: string | null;
  recorded_by?: string | null;
};

/** Same mutable fields as create — used by `updateDraftExpense`. */
export type UpdateDraftExpenseInput = {
  category_id: string;
  vendor_id: string;
  expense_date: string;
  net_amount: number;
  vat_amount?: number;
  remark?: string | null;
  payment_method?: string | null;
  bank_account_id?: string | null;
  /** Vendor bill number from receipt — maps to expenses.vendor_doc_no */
  vendor_doc_no?: string | null;
  wht_type?: string | null;
  wht_rate?: number;
  wht_amount?: number;
  /** Optional — Server Action recomputes/verifies as grand_total - wht_amount */
  net_payable?: number;
  /** Public URL from `uploadExpenseReceipt` → expenses.receipt_url */
  receipt_url?: string | null;
  /** Public URL from payment slip upload → expenses.payment_slip_url */
  payment_slip_url?: string | null;
};

export type UploadExpenseReceiptResult = {
  data: { url: string; path: string } | null;
  error: string | null;
};

export type ExpenseBankAccountOption = {
  id: string;
  bank_name: string;
  account_no: string;
  account_name: string;
  label: string;
};

export type GetExpenseBankAccountsResult = {
  data: ExpenseBankAccountOption[];
  error: string | null;
};

export type CreateExpenseCategoryResult = {
  data: ExpenseCategory | null;
  error: string | null;
};

export type GetExpenseCategoriesResult = {
  data: ExpenseCategory[];
  error: string | null;
};

export type GetExpenseVendorsResult = {
  data: ExpenseVendorOption[];
  error: string | null;
};

export type CreateDraftExpenseResult = MutateExpenseResult;

export type UpdateDraftExpenseResult = MutateExpenseResult;

export type ExpenseListItem = {
  id: string;
  document_no: string;
  /** Document / receipt date (business date on the bill). */
  expense_date: string;
  /** Posting timestamp — when the row was saved (sort key). */
  created_at: string;
  category_id: string | null;
  category_name: string;
  remark: string | null;
  grand_total: number;
  status: string;
};

export type GetExpensesResult = {
  data: ExpenseListItem[];
  error: string | null;
};

/* -------------------------------------------------------------------------- */
/* Expense OCR (Edge Function `ocr-expense` contract)                         */
/* -------------------------------------------------------------------------- */

export type ExpenseOcrVatType = "INCLUSIVE" | "EXCLUSIVE" | "NONE";

export type ExpenseOcrItem = {
  description: string;
  amount: number;
  category_hint: string;
};

export type ExpenseOcrExtraction = {
  vendor_name: string | null;
  tax_id: string | null;
  document_number: string | null;
  document_date: string | null;
  vat_type: ExpenseOcrVatType;
  sub_total: number;
  vat_amount: number;
  grand_total: number;
  items: ExpenseOcrItem[];
};

export type ProcessExpenseOcrResult =
  | { success: true; data: ExpenseOcrExtraction }
  | { success: false; error: string };
