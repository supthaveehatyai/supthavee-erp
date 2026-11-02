import type { VatCalculationType } from "@/lib/utils/document-summary";

/** One bill line after OCR or spreadsheet import, ready for the sales form. */
export type ScannedSalesLine = {
  product_id: string | null;
  sku: string;
  description: string;
  qty: number;
  uom_used: string;
  unit_price: number;
  cost_price: number;
  discount_text: string;
  discount_amount: number;
  line_total: number;
  is_service_item: boolean;
  image_url: string | null;
  match_note: string | null;
};

export type HandwrittenBillScan = {
  doc_date: string | null;
  handwritten_doc_ref: string | null;
  customer_keyword: string | null;
  contact_id: string | null;
  customer_label: string | null;
  notes: string | null;
  vat_type: VatCalculationType;
  items: ScannedSalesLine[];
  model_used: string | null;
  warnings: string[];
};

export type ScanHandwrittenBillResult = {
  data: HandwrittenBillScan | null;
  error: string | null;
};

export type EcommerceChannel = "SHOPEE" | "LAZADA";

export type EcommerceOrderDraft = {
  sales_channel: EcommerceChannel;
  ecommerce_order_no: string;
  ecommerce_buyer_name: string | null;
  tracking_no: string | null;
  doc_date: string;
  items: ScannedSalesLine[];
  duplicate_doc_no: string | null;
};

export type PreviewEcommerceOrdersResult = {
  data: EcommerceOrderDraft[] | null;
  error: string | null;
  detected_channel: EcommerceChannel | null;
};

export type IssueEcommerceOrdersResult = {
  data: {
    issued: { order_no: string; doc_no: string }[];
    skipped: string[];
    failed: { order_no: string; error: string }[];
  } | null;
  error: string | null;
};
