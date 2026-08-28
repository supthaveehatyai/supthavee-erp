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

export type WHTReportSource = "EXP" | "TB";

export type WHTReportRow = {
  id: string;
  /** EXP = expenses, TB = documents (Technician Bill) */
  source: WHTReportSource;
  document_no: string;
  /** expense_date (EXP) or doc_date (TB) — YYYY-MM-DD */
  expense_date: string;
  /** vendor_id / contact_id — for TaxValidationModal */
  contact_id: string | null;
  wht_type: string | null;
  wht_base_amount: number;
  wht_rate: number;
  wht_amount: number;
  wht_doc_no: string | null;
  status: string;
  /** documents.payment_status — TB only */
  payment_status?: string | null;
  contacts: WHTContactTax | null;
};

/** @deprecated Use WHTReportRow */
export type WHTReportExpenseRow = WHTReportRow;

export type MonthlyWHTReportData = {
  raw: WHTReportRow[];
  /** ภ.ง.ด.3 — บุคคลธรรมดา */
  pnd3: WHTReportRow[];
  /** ภ.ง.ด.53 — นิติบุคคล */
  pnd53: WHTReportRow[];
  /**
   * รอตรวจสอบ: entity_type เป็น null หรือยังไม่ validate
   * (รวมกรณีไม่มีผู้จำหน่าย)
   */
  pendingValidation: WHTReportRow[];
  summary: {
    totalWhtBase: number;
    totalWhtAmount: number;
    /** ยอด WHT ของเอกสารที่ชำระแล้ว (PAID / COMPLETED) */
    paidWhtAmount: number;
    /** ยอด WHT รอดำเนินการ (ISSUED / ยังไม่จ่าย) */
    issuedWhtAmount: number;
    paidCount: number;
    issuedCount: number;
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
