/**
 * Product Matrix / Product Model update types (Zero Client-Side Fetching).
 */

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
