/**
 * Phase 14 — Period Closing types.
 * Keep outside `"use server"` modules.
 */

export type AccountingPeriod = {
  id: string | null;
  period_year: number;
  period_month: number;
  is_closed: boolean;
  closed_at: string | null;
  closed_by: string | null;
};

export type GetAccountingPeriodsResult = {
  success: true;
  data: AccountingPeriod[];
  error?: null;
} | {
  success: false;
  data: AccountingPeriod[];
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
