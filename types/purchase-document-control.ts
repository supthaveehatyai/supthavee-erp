import type { GoodsReceiptDocType } from "@/lib/constants/document";
import type { VatCalculationType } from "@/lib/utils/document-summary";
import type { PurchaseVatReviseMode } from "@/lib/utils/purchase-vat-revise";

export type PurchaseControlActionResult = {
  success: boolean;
  error: string | null;
  docNo?: string | null;
};

export type PurchaseCloneLine = {
  key: string;
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  unit_cost: number;
  purchaseUomCode: string;
  conversionFactor: number;
  isFoc: boolean;
  vendorSku: string;
};

export type PurchaseCloneDraft = {
  sourceDocNo: string;
  vendorId: string;
  docDate: string;
  documentRef: string;
  docType: GoodsReceiptDocType;
  vatType: VatCalculationType;
  discountText: string;
  freightCost: number;
  freightTaxMode: string;
  destFreightCost: number;
  lines: PurchaseCloneLine[];
  billUrls: string[];
};

export type PurchaseVatReviseInput = {
  docNo: string;
  mode: PurchaseVatReviseMode;
  reason: string;
};
