import type { GoodsReceiptDocType } from "@/lib/constants/document";
import type { FreightTaxMode } from "@/lib/utils/dual-freight";
import type { VatCalculationType } from "@/lib/utils/document-summary";
import type { SalesProductSearchItem } from "@/types/document";

export type VendorMappedReceiptProduct = SalesProductSearchItem & {
  vendor_sku: string;
  purchase_uom_code: string | null;
  conversion_factor: number | null;
};

export type ManualReceiptVendorContext = {
  docType: GoodsReceiptDocType | null;
  vatType: VatCalculationType | null;
  freightTaxMode: FreightTaxMode | null;
  source: string;
  products: VendorMappedReceiptProduct[];
};

export type GetManualReceiptVendorContextResult = {
  data: ManualReceiptVendorContext | null;
  error: string | null;
};
