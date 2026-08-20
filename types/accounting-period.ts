/**
 * Phase 14 — Period Closing types.
 * Keep outside `"use server"` modules.
 */

export type AccountingPeriod = {
  id: string | null;
  period_year: number;
  period_month: number;
  is_closed: boolean;
  closed_at?: string | null;
  closed_by?: string | null;
};

export type AccountingPeriodListItem = AccountingPeriod & {
  id: string;
  closed_by_name?: string | null;
  closed_by_email?: string | null;
};

/** Payload สำหรับ insert/update `accounting_periods` — ห้ามส่งคีย์ที่เป็น null ตอน Insert */
export type AccountingPeriodWritePayload = {
  period_year: number;
  period_month: number;
  is_closed: boolean;
  closed_at?: string | null;
  closed_by?: string | null;
};

export type GetAccountingPeriodsResult = {
  success: true;
  data: AccountingPeriodListItem[];
  error?: null;
} | {
  success: false;
  data: AccountingPeriodListItem[];
  error: string;
};

export type TogglePeriodStatusResult = {
  success: true;
  data: AccountingPeriodListItem;
  error?: null;
} | {
  success: false;
  data: null;
  error: string;
};

export type CreateAccountingPeriodResult = {
  success: true;
  data: AccountingPeriodListItem;
  error?: null;
} | {
  success: false;
  data: null;
  error: string;
};

export type SetAccountingPeriodClosedResult = {
  success: true;
  data: AccountingPeriod;
  error?: null;
} | {
  success: false;
  data: null;
  error: string;
};

export const THAI_MONTH_LABELS = [
  "มกราคม",
  "กุมภาพันธ์",
  "มีนาคม",
  "เมษายน",
  "พฤษภาคม",
  "มิถุนายน",
  "กรรกฎาคม",
  "สิงหาคม",
  "กันยายน",
  "ตุลาคม",
  "พฤศจิกายน",
  "ธันวาคม",
] as const;

export function formatAccountingPeriodLabel(
  year: number,
  month: number,
): string {
  const label = THAI_MONTH_LABELS[month - 1];
  return label ? `${label} ${year + 543} (${month}/${year})` : `${month}/${year}`;
}
