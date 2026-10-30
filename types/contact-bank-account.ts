export const CONTACT_BANK_CATEGORIES = [
  "CORPORATE_TAX",
  "PERSONAL_NON_TAX",
  "PROMPTPAY",
  "OTHER",
] as const;

export type ContactBankCategory = (typeof CONTACT_BANK_CATEGORIES)[number];

export type ContactBankAccount = {
  id: string;
  contact_id: string;
  account_category: ContactBankCategory;
  bank_code: string;
  bank_name: string;
  account_no: string;
  account_name: string;
  branch_name: string | null;
  qr_image_url: string | null;
  notes: string | null;
  is_default: boolean;
  is_active: boolean;
  created_at: string;
};

export type UpsertContactBankAccountPayload = {
  contactId: string;
  accountId?: string | null;
  accountCategory: ContactBankCategory;
  bankCode: string;
  bankName: string;
  accountNo: string;
  accountName: string;
  branchName?: string | null;
  notes?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
};
