/**
 * Master Data — mst_wht_rates (shared by Server Actions + UI).
 * Kept outside `"use server"` modules.
 */

export type MstWhtRate = {
  id: string;
  wht_name: string;
  wht_rate: number;
  is_active: boolean;
};

export type GetWhtRatesResult = {
  data: MstWhtRate[];
  error: string | null;
};

export type WhtRateActionResult = {
  success: boolean;
  error?: string;
  data?: MstWhtRate;
};
