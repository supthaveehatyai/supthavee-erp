export const MATERIAL_STOCK_MODES = [
  "BOM_BACKFLUSH",
  "SHOP_FLOOR_ISSUE",
  "DIRECT_CONSUMABLE",
] as const;

export type MaterialStockMode = (typeof MATERIAL_STOCK_MODES)[number];

export const MATERIAL_STOCK_MODE_LABELS: Record<MaterialStockMode, string> = {
  BOM_BACKFLUSH: "ตัดตามสูตร BOM",
  SHOP_FLOOR_ISSUE: "เบิกหน้างาน",
  DIRECT_CONSUMABLE: "ตัดเป็นวัสดุสิ้นเปลืองทันที",
};

export type MaterialCategory = {
  code: string;
  nameTh: string;
  nameEn: string;
  defaultPurchaseUom: string;
  defaultUsageUom: string;
  sortOrder: number;
};

export type MaterialRecord = {
  id: string;
  materialCode: string;
  materialName: string;
  specDescription: string | null;
  categoryCode: string;
  categoryName: string;
  stockControlMode: MaterialStockMode;
  purchaseUom: string;
  usageUom: string;
  uomConversionFactor: number;
  referencePurchasePrice: number;
  lastPurchasePrice: number;
  movingAvgUsageCost: number;
  currentUsageQty: number;
  reorderPointUsageQty: number;
  isActive: boolean;
};

export type MaterialDraft = {
  id?: string | null;
  materialCode: string;
  materialName: string;
  specDescription: string;
  categoryCode: string;
  stockControlMode: MaterialStockMode;
  purchaseUom: string;
  usageUom: string;
  uomConversionFactor: number;
  referencePurchasePrice: number;
  reorderPointUsageQty: number;
  isActive: boolean;
};

export type MaterialMatch = {
  id: string;
  materialCode: string;
  materialName: string;
  purchaseUom: string;
  usageUom: string;
  uomConversionFactor: number;
  referencePurchasePrice: number;
};

export type MaterialPurchaseLine = {
  materialId: string;
  description: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
  purchaseUom: string;
  sortOrder: number;
};
