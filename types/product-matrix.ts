/**
 * Product Matrix / Product Model types (Zero Client-Side Fetching).
 * Kept outside `"use server"` modules — Next.js only allows async function
 * exports from Server Action files.
 */

export type TaxType = "INC_VAT" | "EXC_VAT" | "NON_VAT";

export type SaveDraftModelInput = {
  vendorId: string;
  brandId: string;
  categoryId: string;
  modelCode: string;
  name: string;
  shortName?: string;
  gender: string;
  taxType: TaxType;
  /** JSON string for product_models.size_pricing_config */
  sizePricingConfig?: string;
  /** Public URL จาก Storage bucket product_assets */
  imageUrl?: string;
  /** product_models.is_service — งานบริการ ไม่ตัดสต็อก */
  isService?: boolean;
  /** product_models.is_raw_material — วัตถุดิบ (ไม่แสดงใน Sales SKU Picker) */
  isRawMaterial?: boolean;
  /** product_models.is_manufactured — ผลิตเอง (Make); vendor ไม่บังคับ */
  isManufactured?: boolean;
  /** product_models.base_uom_id → mst_uom.uom_id */
  baseUomId?: string | null;
};

export type ExistingProductModel = {
  id: string;
  model_code: string;
  name: string;
  short_name: string | null;
  gender: string | null;
  tax_type: string | null;
  status: string | null;
  vendor_id: string | null;
  brand_id: string | null;
  category_id: string | null;
  size_pricing_config: unknown;
  image_url: string | null;
  is_service: boolean;
  is_raw_material: boolean;
  is_manufactured: boolean;
  base_uom_id: string | null;
};

export type UploadProductModelImageResult = {
  ok: boolean;
  url?: string;
  path?: string;
  error?: string;
};

export type SaveDraftModelResult = {
  ok: boolean;
  modelId?: string;
  overwritten?: boolean;
  error?: string;
};

export type GenerateSkuRow = {
  sku: string;
  name: string;
  shortName: string;
  description: string;
  category: string | null;
  color: string;
  size: string;
  gender: string;
  taxType: TaxType;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
};

export type GenerateSkusInput = {
  /** Existing draft/parent model id from Phase 1 (optional — created if missing). */
  modelId?: string | null;
  model: SaveDraftModelInput;
  vendorId?: string;
  skus: GenerateSkuRow[];
};

export type GenerateSkusResult = {
  ok: boolean;
  modelId?: string;
  inserted?: number;
  skipped?: number;
  error?: string;
};

export type LoadableProductModel = ExistingProductModel & {
  brand_code?: string | null;
  brand_name?: string | null;
  category_code?: string | null;
  category_name?: string | null;
};

export type UpdateProductModelSizePrice = {
  /** รหัสไซส์จาก mst_sizes.size_code (หรือค่าที่ตรงกับ products.size) */
  sizeCode: string;
  /** ป้ายไซส์บน products.size — ถ้าไม่ส่ง จะ resolve จาก mst_sizes */
  sizeLabel?: string | null;
  costPrice: number;
  retailPrice: number;
  wholesalePrice: number;
};

export type UpdateProductModelResult = {
  ok: boolean;
  modelId?: string;
  updatedSkuCount?: number;
  error?: string;
};
