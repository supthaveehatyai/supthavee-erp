/**
 * Phase 8 — Expense Management constants.
 * Kept outside `"use server"` modules — Next.js only allows async function
 * exports from Server Action files.
 */

/** Standardized duplicate-invoice early-warning code (Phase 3 pattern). */
export const DUPLICATE_INVOICE_ERROR = "DUPLICATE_INVOICE" as const;

export const DUPLICATE_INVOICE_MESSAGE =
  "ตรวจพบเอกสารซ้ำ! บิลค่าใช้จ่ายเลขที่นี้ของผู้ให้บริการรายนี้ ในวันที่ดังกล่าว ถูกบันทึกเข้าระบบไปแล้ว";

/** Common WHT rate presets (percent) for expense UI. */
export const EXPENSE_WHT_RATES = [0, 1, 1.5, 2, 3, 5] as const;

/** Tolerance for money equality checks (2 decimal baht). */
export const EXPENSE_MONEY_EPSILON = 0.02;

export type ExpenseWhtOption = {
  /** Stored in expenses.wht_type — empty string = None */
  value: string;
  label: string;
  rate: number;
};

/**
 * Standard Thai WHT presets for OPEX (หัก ณ ที่จ่าย).
 * Selecting an option sets both `wht_type` and `wht_rate` in the form.
 */
export const EXPENSE_WHT_OPTIONS: readonly ExpenseWhtOption[] = [
  { value: "", label: "None (0%)", rate: 0 },
  { value: "ค่าขนส่ง", label: "ค่าขนส่ง (1%)", rate: 1 },
  { value: "ค่าโฆษณา", label: "ค่าโฆษณา (2%)", rate: 2 },
  {
    value: "ค่าบริการ/รับเหมา/วิชาชีพอิสระ",
    label: "ค่าบริการ/รับเหมา/วิชาชีพอิสระ (3%)",
    rate: 3,
  },
  { value: "ค่าเช่า", label: "ค่าเช่า (5%)", rate: 5 },
] as const;
