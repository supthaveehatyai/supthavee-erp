/**
 * Master Category catalog (`mst_categories`) — keep outside `"use server"` modules.
 */

export type CategoryKind = "parent" | "child";

export type MasterCategoryRow = {
  id: string;
  category_code: string;
  category_name: string;
  parent_id: string | null;
  is_active: boolean;
  parent_name: string | null;
  parent_code: string | null;
};

export type GetCategoriesResult =
  | { success: true; data: MasterCategoryRow[] }
  | { success: false; error: string; data: MasterCategoryRow[] };

export type MutateCategoryResult =
  | { success: true; data: MasterCategoryRow }
  | { success: false; error: string; data: null };

export type CreateCategoryInput = {
  category_code: string;
  category_name: string;
  kind: CategoryKind;
  parent_id?: string | null;
};

export type UpdateCategoryInput = CreateCategoryInput & {
  id: string;
};
