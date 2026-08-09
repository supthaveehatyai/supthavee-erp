/**
 * Phase 10 — Company / system settings (singleton id = 1).
 * Keep types out of Server Action modules.
 */

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
  vat_rate: number;
  logo_url?: string;
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
