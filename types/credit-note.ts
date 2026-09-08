/**
 * Phase 18 — Credit Note (CN) types.
 * Kept outside `"use server"` modules.
 */

import type { DocumentStatus, DocumentType } from "@/types/document";
import type { VatCalculationType } from "@/lib/utils/document-summary";

export type CreditNoteSourceItem = {
  source_item_id: string;
  product_id: string;
  sku: string | null;
  description: string;
  image_url: string | null;
  is_service: boolean;
  uom_used: string;
  source_qty: number;
  credited_qty: number;
  remaining_qty: number;
  unit_price: number;
  unit_cost_price: number;
  discount_amount: number;
  line_total: number;
  sort_order: number;
};

export type CreditNoteSourceDocument = {
  id: string;
  doc_no: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  doc_date: string;
  contact_id: string;
  contact_person_id: string | null;
  customer_name: string;
  vat_type: VatCalculationType;
  vat_rate: number;
  discount_text: string | null;
  discount_amount: number;
  total_amount: number;
  grand_total: number;
  remaining_grand_total: number;
  items: CreditNoteSourceItem[];
};

export type GetCreditNoteSourceResult = {
  data: CreditNoteSourceDocument | null;
  error: string | null;
};

export type CreateCreditNoteItemInput = {
  source_item_id: string;
  qty: number;
  return_to_inventory: boolean;
};

export type CreateCreditNoteInput = {
  ref_document_id: string;
  doc_date?: string | null;
  notes?: string | null;
  items: CreateCreditNoteItemInput[];
};

export type CreateCreditNoteResult = {
  data: {
    document_id: string;
    document_no: string;
  } | null;
  error: string | null;
};
