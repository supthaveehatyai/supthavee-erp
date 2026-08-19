/** Raw line item from Vision AI OCR (legacy shape) */
export interface OcrLineItem {
  raw_code: string;
  raw_description: string;
  qty: number;
  unit_price: number;
}

/** OCR line for Smart Goods Receipt Verification Table */
export interface OcrVerificationItem {
  raw_vendor_sku: string;
  qty: number;
  unit_price: number;
  discount_text: string;
  /** Optional description from OCR / invoice */
  raw_description?: string;
}

export interface ProductSummary {
  id: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  gender: string | null;
  base_uom: string | null;
  is_active: boolean;
}

export interface VendorMappingMatch {
  id: string;
  vendor_id: string;
  vendor_sku: string;
  vendor_product_name: string | null;
  vendor_uom: string | null;
  internal_product_id: string;
  conversion_factor: number | null;
  product: ProductSummary | null;
}

export type VerificationRowStatus = "ready" | "action_required" | "looking_up";

/** One row in the OCR verification table after lookup */
export interface OcrVerificationRow {
  lineKey: string;
  item: OcrVerificationItem;
  normalizedSku: string;
  status: VerificationRowStatus;
  mapping: VendorMappingMatch | null;
  product: ProductSummary | null;
  unitCostPrice: number;
  discountAmountPerUnit: number;
}

/** OCR line that resolved to an internal product via vendor_product_mapping */
export interface MatchedOcrLine {
  lineKey: string;
  ocr: OcrLineItem;
  normalizedSku: string;
  mapping: VendorMappingMatch;
  product: ProductSummary;
}

/** OCR line with no mapping — requires warehouse staff action */
export interface UnmatchedOcrLine {
  lineKey: string;
  ocr: OcrLineItem;
  normalizedSku: string;
}

export interface OcrMatchResult {
  matched: MatchedOcrLine[];
  unmatched: UnmatchedOcrLine[];
}

export interface CreateOnTheFlyMappingInput {
  vendorId: string;
  vendorSku: string;
  vendorProductName: string;
  internalProductId: string;
}

export interface VendorOption {
  id: string;
  company_name: string;
  /** Multi-role tags from contacts.contact_roles (never contact_type). */
  contact_roles?: string[];
}
