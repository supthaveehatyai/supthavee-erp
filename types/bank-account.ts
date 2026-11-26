/**
 * Phase 5 — Bank account master types.
 * Kept outside `"use server"` modules.
 */

export type BankAccount = {
  id: string;
  bank_name: string;
  account_no: string;
  account_name: string;
  branch_name: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  qr_image_url?: string | null;
  qr_storage_path?: string | null;
  promptpay_note?: string | null;
};

export type GetBankAccountsResult = {
  data: BankAccount[];
  error: string | null;
};

export type MutateBankAccountResult = {
  success: boolean;
  error: string | null;
};
