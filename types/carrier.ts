export const CARRIER_TIERS = ["PRIMARY_MONTHLY", "OCCASIONAL"] as const;

export type CarrierTier = (typeof CARRIER_TIERS)[number];

export type CarrierOption = {
  carrier_id: string;
  carrier_code: string;
  carrier_name: string;
  contact_id: string | null;
  carrier_tier: CarrierTier;
  requires_monthly_receipt: boolean;
  tax_id: string | null;
  branch_code: string | null;
  phone: string | null;
  address: string | null;
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
  carrier_tax_id: string | null;
  carrier_branch_code: string | null;
  dest_freight_cost: number;
  estimated_wht_1pct: number;
  carrier_tracking_no: string | null;
  carrier_receipt_status: string;
  carrier_receipt_no: string | null;
  carrier_receipt_date: string | null;
};
