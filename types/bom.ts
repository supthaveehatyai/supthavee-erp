/**
 * Bill of Materials (product_boms) types.
 * Keep outside `"use server"` modules.
 */

export type BOMItemRow = {
  id: string;
  finished_model_id: string;
  raw_material_model_id: string;
  raw_material_model_code: string;
  raw_material_model_name: string;
  uom_id: string;
  uom_code: string;
  uom_name: string;
  quantity_required: number;
  waste_percent: number;
  /**
   * products.cost_price จาก SKU ลูกตัวแรกของวัตถุดิบ
   * (null หากยังไม่มี SKU / ยังไม่มีต้นทุน)
   */
  cost_price: number | null;
  /**
   * ต้นทุนประเมินต่อ 1 หน่วยสำเร็จรูป:
   * quantity_required * (1 + waste_percent/100) * cost_price
   */
  estimated_cost: number;
  created_by: string | null;
  created_at: string | null;
};

export type GetBOMByModelIdResult =
  | { success: true; data: BOMItemRow[] }
  | { success: false; error: string; data: BOMItemRow[] };

export type AddBOMItemPayload = {
  /** รุ่นสินค้าสำเร็จรูป (product_models.id → product_boms.finished_model_id) */
  finished_model_id: string;
  /** รุ่นวัตถุดิบ (product_models.id, is_raw_material = true) */
  raw_material_model_id: string;
  /** ปริมาณที่ใช้ต่อ 1 หน่วยสินค้าสำเร็จรูป */
  quantity_required: number | string;
  /** เปอร์เซ็นต์เผื่อเสีย (0–100) */
  waste_percent: number | string;
};

export type MutateBOMItemResult = {
  success: boolean;
  error: string | null;
  id?: string;
};

export type RawMaterialModelOption = {
  id: string;
  model_code: string;
  name: string;
  base_uom_id: string | null;
  uom_code: string | null;
  uom_name: string | null;
};

export type SearchRawMaterialModelsResult =
  | { success: true; data: RawMaterialModelOption[] }
  | { success: false; error: string; data: RawMaterialModelOption[] };
