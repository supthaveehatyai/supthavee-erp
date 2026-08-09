/**
 * Phase 11 — Product Model Thumbnail Preview (สินค้าและราคา).
 */

export type ProductModelPreview = {
  id: string;
  model_code: string;
  name: string;
  short_name: string | null;
  image_url: string | null;
  gender: string | null;
  brand_code: string | null;
  brand_name: string | null;
  category_code: string | null;
  category_name: string | null;
};

export type GetProductModelPreviewResult = {
  data: ProductModelPreview | null;
  error: string | null;
};
