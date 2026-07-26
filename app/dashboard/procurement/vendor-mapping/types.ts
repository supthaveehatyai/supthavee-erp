export type VendorOption = {
  id: string;
  company_name: string;
};

export type ProductOption = {
  id: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  gender: string | null;
  base_uom: string | null;
  is_active: boolean;
  model_id?: string | null;
};

export type ModelSku = {
  id: string;
  sku: string;
  name: string;
  /** Display / Thai color name stored on products.color */
  color: string | null;
  /** Internal color code for SKU matrix (e.g. BLK, NVY) */
  color_code: string | null;
  size: string | null;
  /** Size code used in Vendor SKU Pattern [SIZE] */
  size_code: string | null;
  base_uom: string | null;
  is_active: boolean;
};

export type ProductModelGroup = {
  id: string;
  model_code: string;
  name: string;
  short_name: string | null;
  status: string | null;
  vendor_id: string | null;
  products: ModelSku[];
};

export type VendorMappingRow = {
  id: string;
  vendor_id: string;
  vendor_sku: string;
  vendor_product_name: string | null;
  vendor_uom: string | null;
  internal_product_id: string;
  conversion_factor: number | null;
  created_at: string;
  product: ProductOption | ProductOption[] | null;
};

export type FlattenedVendorMapping = Omit<VendorMappingRow, "product"> & {
  product: ProductOption | null;
};

export type CreateVendorMappingInput = {
  vendorId: string;
  vendorSku: string;
  vendorProductName: string;
  vendorUom?: string;
  internalProductId: string;
  conversionFactor?: number;
};

export type BulkMappingInsertRow = {
  vendor_id: string;
  vendor_sku: string;
  vendor_product_name: string | null;
  vendor_uom: string | null;
  internal_product_id: string;
  conversion_factor: number;
};

export type BulkMappingResult = {
  inserted: number;
  skipped: number;
  error: string | null;
};

/** Default vendor SKU pattern for matrix expansion */
export const DEFAULT_VENDOR_SKU_PATTERN = "[MODEL]-[COLOR]-[SIZE]";

export const DUPLICATE_VENDOR_SKU_MESSAGE =
  "รหัสสินค้านี้ถูกผูกไว้กับ Vendor เจ้านี้แล้ว";
