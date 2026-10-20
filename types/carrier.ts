export type CarrierOption = {
  carrier_id: string;
  carrier_code: string;
  carrier_name: string;
  tax_id: string | null;
  phone: string | null;
  default_wht_rate: number;
  sort_order: number;
};

export type DestFreightSummaryRow = {
  document_id: string;
  doc_no: string;
  doc_date: string;
  vendor_name: string | null;
  carrier_id: string;
  carrier_name: string;
  default_wht_rate: number;
  dest_freight_cost: number;
  carrier_tracking_no: string | null;
  carrier_receipt_status: string;
  carrier_receipt_no: string | null;
  carrier_receipt_date: string | null;
};
