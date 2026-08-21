/**
 * Phase 14 — Fixed Asset Management types.
 * Kept outside `"use server"` modules (Turbopack / type separation).
 * DB columns follow `@/src/types/supabase` (Cloud source of truth).
 */

export type FixedAssetStatus =
  | "ACTIVE"
  | "DISPOSED"
  | "UNDER_MAINTENANCE";

export type AssetCategory = {
  id: string;
  category_code: string;
  category_name: string;
  useful_life_years: number;
  depreciation_rate: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FixedAssetListItem = {
  id: string;
  asset_code: string;
  asset_name: string;
  category_id: string;
  category_code: string | null;
  category_name: string | null;
  location: string | null;
  /** UI alias of DB `acquisition_date` */
  purchase_date: string;
  acquisition_cost: number;
  salvage_value: number;
  /** UI convenience — derived from `useful_life_months` */
  useful_life_years: number | null;
  useful_life_months: number;
  accumulated_depreciation: number;
  net_book_value: number;
  status: FixedAssetStatus;
  created_at: string;
  updated_at: string;
};

export type FixedAssetFilters = {
  query?: string;
  status?: FixedAssetStatus | "ALL" | "";
};

export type GetAssetCategoriesResult = {
  data: AssetCategory[];
  error: string | null;
};

export type GetFixedAssetsResult = {
  data: FixedAssetListItem[];
  error: string | null;
};

export type CreateFixedAssetInput = {
  asset_code: string;
  asset_name: string;
  category_id: string;
  location?: string | null;
  purchase_date: string;
  acquisition_cost: number;
  salvage_value?: number | null;
  useful_life_years?: number | null;
};

export type UpdateFixedAssetInput = {
  id: string;
  asset_code: string;
  asset_name: string;
  category_id: string;
  location?: string | null;
  purchase_date: string;
  acquisition_cost: number;
  salvage_value?: number | null;
  useful_life_years?: number | null;
  status: FixedAssetStatus;
};

export type MutateFixedAssetResult = {
  success: boolean;
  error: string | null;
  id?: string | null;
};

export type DisposeFixedAssetResult = {
  success: boolean;
  error: string | null;
};

export const FIXED_ASSET_STATUS_LABELS: Record<FixedAssetStatus, string> = {
  ACTIVE: "ใช้งาน",
  DISPOSED: "จำหน่ายแล้ว",
  UNDER_MAINTENANCE: "ซ่อมบำรุง",
};

export const FIXED_ASSET_STATUSES: FixedAssetStatus[] = [
  "ACTIVE",
  "UNDER_MAINTENANCE",
  "DISPOSED",
];
