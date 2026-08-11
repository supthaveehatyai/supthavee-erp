/**
 * Model-First product search / sale matrix types.
 * Keep outside `"use server"` modules.
 */

export type ProductModelSearchItem = {
  id: string;
  model_code: string;
  name: string;
  short_name: string | null;
  image_url: string | null;
  /** model_code · name */
  display_name: string;
  /** true = งานบริการ — Bypass เช็คสต็อก */
  is_service: boolean;
};

export type SearchProductModelsResult =
  | { success: true; data: ProductModelSearchItem[] }
  | { success: false; error: string; data: ProductModelSearchItem[] };

export type ModelMatrixSkuRow = {
  product_id: string;
  sku: string;
  name: string;
  color_code: string;
  color_name: string;
  size_code: string;
  size_label: string;
  sort_order: number;
  /** ราคาขายปลีก (products.retail_price) */
  unit_price: number;
  /** ต้นทุน LPP (products.cost_price) — snapshot ตอนขาย */
  cost_price: number;
  base_uom: string | null;
  /**
   * Running balance จาก Σ inventory_ledger (IN − OUT ± ADJUST)
   * อนุญาตค่าติดลบตามจริงเมื่อเปิด Allow Negative Inventory
   */
  stock_balance: number;
  /** สืบทอดจาก product_models.is_service — ไม่ตัดสต็อก */
  is_service: boolean;
};

export type ModelMatrixForSale = {
  model_id: string;
  model_code: string;
  model_name: string;
  image_url: string | null;
  /** true = รุ่นงานบริการ — Bypass เช็คสต็อกใน UI */
  is_service: boolean;
  /** SKUs เรียง color_name แล้วตาม size sort_order */
  skus: ModelMatrixSkuRow[];
};

export type GetModelMatrixForSaleResult =
  | { success: true; data: ModelMatrixForSale }
  | { success: false; error: string; data: null };
