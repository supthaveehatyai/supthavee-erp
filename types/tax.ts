/**
 * Phase 8.5 — Tax & WHT types (shared by Server Actions + UI).
 * Kept outside `"use server"` modules — Next.js only allows async function
 * exports from Server Action files.
 */

export type TaxEntityType = "INDIVIDUAL" | "CORPORATE";

export type WHTContactTax = {
  id: string;
  company_name: string;
  tax_id: string | null;
  tax_branch_code: string | null;
  entity_type: string | null;
  tax_address: string | null;
  is_tax_validated: boolean | null;
};

export type WHTReportExpenseRow = {
  id: string;
  document_no: string;
  expense_date: string;
  /** expenses.vendor_id — for TaxValidationModal */
  contact_id: string | null;
  wht_type: string | null;
  wht_base_amount: number;
  wht_rate: number;
  wht_amount: number;
  wht_doc_no: string | null;
  status: string;
  contacts: WHTContactTax | null;
};

export type MonthlyWHTReportData = {
  raw: WHTReportExpenseRow[];
  /** ภ.ง.ด.3 — บุคคลธรรมดา */
  pnd3: WHTReportExpenseRow[];
  /** ภ.ง.ด.53 — นิติบุคคล */
  pnd53: WHTReportExpenseRow[];
  /**
   * รอตรวจสอบ: entity_type เป็น null หรือยังไม่ validate
   * (รวมกรณีไม่มีผู้จำหน่าย)
   */
  pendingValidation: WHTReportExpenseRow[];
  summary: {
    totalWhtBase: number;
    totalWhtAmount: number;
  };
};

export type GetMonthlyWHTReportResult =
  | { success: true; data: MonthlyWHTReportData }
  | { success: false; error: string };

export type VendorTaxInfoInput = {
  entity_type: TaxEntityType;
  tax_id: string;
  tax_branch_code?: string | null;
  tax_address?: string | null;
};

export type UpdateVendorTaxInfoResult = {
  success: boolean;
  error: string | null;
};
