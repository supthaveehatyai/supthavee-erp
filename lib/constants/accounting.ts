/**
 * Shared accounting constants — VAT taxonomy for the entire ERP.
 * Keep outside `"use server"` modules (Next.js only allows async exports there).
 */

export type VatOptionValue = "NONE" | "INCLUSIVE" | "EXCLUSIVE";

export type VatOption = {
  value: VatOptionValue;
  label: string;
};

/** Canonical VAT dropdown options — use across Sales / Purchases / Expenses. */
export const VAT_OPTIONS: readonly VatOption[] = [
  { value: "NONE", label: "ไม่มีภาษี (None)" },
  { value: "INCLUSIVE", label: "รวมภาษีมูลค่าเพิ่ม (Inclusive)" },
  { value: "EXCLUSIVE", label: "แยกภาษีมูลค่าเพิ่ม (Exclusive)" },
] as const;

export const DEFAULT_VAT_RATE = 7;
