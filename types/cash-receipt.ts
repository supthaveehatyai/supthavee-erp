export type VendorTaxTier = "CORP_VAT" | "INDIVIDUAL_ID_1_2" | "INTERNAL_NO_ID_1_3";

export type AccountingTaxTier = "CORP_VAT" | "RECEIPT_1_2" | "INTERNAL_1_3";

export type CashReceiptLine = {
  description: string;
  qty: number;
  unitPrice: number;
  amount: number;
};

export type CashReceiptBill = {
  id: string;
  docNo: string;
  docDate: string;
  cashReceiptNo: string | null;
  vendorName: string;
  vendorAddress: string | null;
  vendorTaxId: string | null;
  grandTotal: number;
  discountAmount: number;
  goodsBase: number;
  vatPortion: number;
  lines: CashReceiptLine[];
};

export type CashReceiptPack = {
  fromDate: string;
  toDate: string;
  bills: CashReceiptBill[];
  error: string | null;
};
