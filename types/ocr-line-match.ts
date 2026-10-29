export type OcrLineMatchTier = "EXACT" | "NORMALIZED" | "FUZZY";

/** One row from `match_vendor_ocr_line_item`, or the local mapping fallback. */
export type OcrLineMatchResult = {
  matched: boolean;
  mappingId: string | null;
  internal_product_id: string | null;
  sku: string | null;
  product_name: string | null;
  color: string | null;
  size: string | null;
  base_uom?: string | null;
  is_raw_material?: boolean | null;
  default_tax_type: string | null;
  purchase_uom_code: string | null;
  conversion_factor: number | null;
  match_tier: OcrLineMatchTier | null;
  similarity_score: number | null;
  error: string | null;
};
