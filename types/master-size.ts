/**
 * Master Size catalog (`mst_sizes`) — keep outside `"use server"` modules.
 */

export type MasterSizeRow = {
  id: string;
  size_code: string;
  size_label: string;
  sort_order: number;
  is_active: boolean;
  brand_id: string | null;
};

export type GetSizesResult =
  | { success: true; data: MasterSizeRow[] }
  | { success: false; error: string; data: MasterSizeRow[] };

export type MutateSizeResult =
  | { success: true; data: MasterSizeRow }
  | { success: false; error: string; data: null };

export type CreateSizeInput = {
  size_code: string;
  size_label: string;
  sort_order: number;
};

export type UpdateSizeInput = {
  id: string;
  size_code: string;
  size_label: string;
  sort_order: number;
};
