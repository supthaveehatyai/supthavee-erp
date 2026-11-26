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
  qr_label?: string | null;
  promptpay_note?: string | null;
  is_qr_customer_visible?: boolean;
};

export type BankQrSettingsInput = {
  id: string;
  qr_label: string | null;
  promptpay_note: string | null;
  is_qr_customer_visible: boolean;
};

export function isInternalClearingWallet(parts: Array<string | null | undefined>): boolean {
  const blob = parts.filter((part) => part && part.trim()).join(" ").toLowerCase();
  return (
    blob.includes("shopee-wallet") ||
    blob.includes("lazada-wallet") ||
    blob.includes("shopee seller") ||
    blob.includes("lazada seller") ||
    blob.includes("ถุงเงิน")
  );
}

export type GetBankAccountsResult = {
  data: BankAccount[];
  error: string | null;
};

export type MutateBankAccountResult = {
  success: boolean;
  error: string | null;
};
