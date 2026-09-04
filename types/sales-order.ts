/**
 * Phase 17 — Sales Order (SO) types.
 * Keep outside `"use server"` modules.
 */

import type {
  CreateDraftDocumentItemInput,
  CustomerOption,
  DocumentDetail,
  DocumentStatus,
  SalesDocumentListItem,
  VatCalculationType,
} from "@/types/document";

export type SalesOrderLineItem = {
  key: string;
  product_id: string;
  sku: string;
  description: string;
  qty: number;
  uom_used: string;
  unit_price: number;
  cost_price: number;
  discount_text: string;
  discount_amount: number;
  line_total: number;
  image_url: string | null;
  model_id: string | null;
  model_code: string | null;
  is_manufactured: boolean;
};

export type SaveSalesOrderDraftInput = {
  document_id?: string | null;
  contact_id: string;
  contact_person_id?: string | null;
  /** YYYY-MM-DD */
  doc_date: string;
  notes?: string | null;
  /** Public URL ใน bucket production_attachments */
  mockup_image_url?: string | null;
  items: CreateDraftDocumentItemInput[];
  discount_text?: string | null;
  vat_type?: VatCalculationType;
  vat_rate?: number;
  total_amount?: number;
  discount_amount?: number;
  net_before_vat?: number;
  vat_amount?: number;
  grand_total?: number;
};

export type SaveSalesOrderDraftResult = {
  success: boolean;
  error: string | null;
  data: {
    document_id: string;
    document_no: string;
    status: DocumentStatus;
  } | null;
};

export type SendSalesOrderToProductionInput = SaveSalesOrderDraftInput;

export type SendSalesOrderToProductionResult = {
  success: boolean;
  error: string | null;
  data: {
    document_id: string;
    document_no: string;
    status: DocumentStatus;
    jobs: { id: string; job_no: string; items_count: number; materials_count: number }[];
  } | null;
};

export type UploadSalesOrderMockupResult = {
  success: boolean;
  error: string | null;
  data: { url: string; path: string } | null;
};

export type GetSalesOrdersResult = {
  data: SalesDocumentListItem[];
  error: string | null;
};

export type SalesOrderWorkspaceProps = {
  customers: CustomerOption[];
  customersError?: string | null;
  document?: DocumentDetail | null;
};
