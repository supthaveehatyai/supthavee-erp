/**
 * Phase 32.2 — Colorway Visual Catalog.
 * Shapes match Cloud RPCs `search_colorway_sales_catalog`
 * and `get_model_colorway_cropper_state`.
 * Selling prices and on-hand qty only — no vendor or cost fields.
 */

export type ColorFamilyOption = {
  color_family: string;
  color_family_th: string;
  hex_code: string | null;
};

export type CatalogCategoryOption = {
  id: string;
  category_code: string;
  category_name: string;
};

export type ColorwaySizeBreakdown = {
  sku: string;
  size: string;
  product_id: string;
  on_hand_qty: number;
  retail_price: number;
  wholesale_price: number;
};

export type ColorwayCatalogItem = {
  model_id: string;
  model_code: string;
  model_name: string;
  model_short_name: string | null;
  brand_code: string | null;
  brand_name: string | null;
  category_id: string | null;
  category_code: string | null;
  category_name: string | null;
  gender: string | null;
  color_id: string;
  color_code: string;
  color_name: string;
  color_family: string | null;
  color_family_th: string | null;
  hex_code: string | null;
  display_image_url: string | null;
  colorway_image_url: string | null;
  model_poster_url: string | null;
  has_colorway_image: boolean;
  total_on_hand_qty: number;
  in_stock_size_count: number;
  min_retail_price: number | null;
  max_retail_price: number | null;
  min_wholesale_price: number | null;
  max_wholesale_price: number | null;
  sizes_breakdown: ColorwaySizeBreakdown[];
};

export type ModelColorCropperItem = {
  color_id: string;
  color_code: string;
  color_name: string;
  color_family: string | null;
  color_family_th: string | null;
  hex_code: string | null;
  sku_count: number;
  colorway_image_url: string | null;
  storage_path: string | null;
  crop_meta: Record<string, unknown> | null;
};

export type ModelColorCropperModel = {
  model_id: string;
  model_code: string;
  name: string;
  short_name: string | null;
  poster_image_url: string | null;
};

export type ModelColorCropperState = {
  ok: boolean;
  model: ModelColorCropperModel;
  colors: ModelColorCropperItem[];
  error?: string;
};

export type ColorwayCatalogQuery = {
  q?: string;
  family?: string;
  categoryId?: string;
  inStockOnly?: boolean;
};

export type SearchColorwayCatalogResult = {
  items: ColorwayCatalogItem[];
  truncated: boolean;
  error: string | null;
};

export type CatalogFilterMetadata = {
  categories: CatalogCategoryOption[];
  families: ColorFamilyOption[];
  error: string | null;
};

export type ColorwayCropperStateResult = {
  state: ModelColorCropperState | null;
  error: string | null;
};

export type ColorwayMutationResult =
  | { ok: true; imageUrl: string; storagePath: string }
  | { ok: false; error: string };

export type ColorwayDeleteResult =
  | { ok: true }
  | { ok: false; error: string };
