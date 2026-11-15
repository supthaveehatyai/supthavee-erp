/**
 * แถวที่ `get_batch_sales_documents_for_pdf` คืนมา
 * อยู่ไฟล์นี้เพื่อไม่ให้ export type จากโมดูล `"use server"`
 */

export type BatchSalesPdfItem = {
  id: string;
  description: string;
  qty: number;
  uom_used: string;
  unit_price: number;
  line_total: number;
};

export type BatchSalesPdfDocument = {
  id: string;
  doc_no: string;
  doc_type: string;
  status: string;
  is_voided: boolean;
  doc_date: string;
  sales_channel: string;
  customer_name: string;
  customer_tax_id: string;
  customer_branch: string;
  customer_address: string;
  net_before_vat: number;
  vat_amount: number;
  grand_total: number;
  vat_type: string;
  items: BatchSalesPdfItem[];
};
