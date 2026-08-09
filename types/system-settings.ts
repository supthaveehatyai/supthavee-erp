/**
 * Phase 10 — Company / system settings (singleton id = 1).
 * Keep types out of Server Action modules.
 */

/** Print paper overrides keyed by document type code (e.g. INV_DO → A5-Landscape). */
export type DocumentPrintSettings = Record<string, string>;

export type SystemSettings = {
  id: number;
  company_name: string;
  company_name_en: string;
  tax_id: string;
  branch_code: string;
  branch_name: string;
  address: string;
  phone: string;
  email: string;
  logo_url: string;
  vat_rate: number;
  gl_rounding_expense_acc: string;
  gl_rounding_income_acc: string;
  /** JSON map: doc_type → PrintPaperSize */
  document_print_settings: DocumentPrintSettings;
  /** Allow sales OUT when on-hand is insufficient (negative stock) */
  allow_negative_inventory: boolean;
  updated_at: string;
  updated_by: string | null;
};

export type SystemSettingsFormData = {
  company_name: string;
  tax_id: string;
  branch_code: string;
  branch_name: string;
  address: string;
  phone: string;
  email: string;
  vat_rate: number;
  logo_url?: string;
  allow_negative_inventory?: boolean;
};

export type UploadCompanyLogoResult =
  | { success: true; url: string; path: string }
  | { success: false; error: string };

export type GetSystemSettingsResult =
  | { success: true; data: SystemSettings }
  | { success: false; error: string };

export type UpdateSystemSettingsResult =
  | { success: true; data: SystemSettings }
  | { success: false; error: string };

export type UpdateDocumentPrintSettingResult =
  | { success: true; data: SystemSettings }
  | { success: false; error: string };
