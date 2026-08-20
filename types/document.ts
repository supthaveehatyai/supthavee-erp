/**
 * Phase 4 — Document types (shared by Server Actions + UI).
 * Kept outside `"use server"` modules — Next.js only allows async function exports there.
 */

import {
  DOCUMENT_STATUSES,
  DOCUMENT_TYPES,
} from "@/lib/constants/document";
import type { VatCalculationType } from "@/lib/utils/document-summary";

export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];
export type { VatCalculationType };

export type DocumentRow = {
  id: string;
  created_at: string;
  updated_at: string;
  doc_no: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  doc_date: string;
  due_date: string | null;
  contact_id: string;
  contact_person_id: string | null;
  ref_doc_id: string | null;
  /** Source document id when created via convertDocument. */
  ref_document_id?: string | null;
  sub_total: number;
  discount_amount: number;
  tax_rate: number;
  tax_amount: number;
  wht_rate: number;
  wht_amount: number;
  grand_total: number;
  deposit_deducted: number;
  payment_status: string;
  notes: string | null;
  attached_file_url: string | null;
  /** Bill image URL in `document_attachments` storage bucket. */
  attachment_url?: string | null;
  original_file_name: string | null;
  vat_type?: VatCalculationType;
  vat_rate?: number;
  total_amount?: number;
  net_before_vat?: number;
  vat_amount?: number;
  discount_text?: string | null;
};

export type CustomerOption = {
  id: string;
  company_name: string;
};

export type ContactPersonOption = {
  id: string;
  contact_id: string;
  name: string;
  phone: string | null;
  email: string | null;
  department_or_role: string | null;
  is_primary: boolean;
};

export type CreateDocumentInput = {
  doc_type: DocumentType;
  contact_id: string;
  /** Optional — ผู้ติดต่อของลูกค้าที่เลือก */
  contact_person_id?: string | null;
};

export type CreateDocumentResult = {
  data: DocumentRow | null;
  error: string | null;
};

/** Line payload for `createDraftDocument` — prices come from the sales UI. */
export type CreateDraftDocumentItemInput = {
  product_id: string;
  description?: string;
  qty: number;
  uom_used?: string;
  /** Selling price (may be edited by staff). */
  unit_price: number;
  /** Cost Snapshot at pick/save time. */
  unit_cost_price: number;
  discount_text?: string;
  discount_amount?: number;
  line_total: number;
  sort_order?: number;
};

export type CreateDraftDocumentInput = {
  doc_type: DocumentType;
  contact_id: string;
  contact_person_id?: string | null;
  /** Optional ISO date `YYYY-MM-DD` — defaults to today. */
  doc_date?: string | null;
  items?: CreateDraftDocumentItemInput[];
  /** Bill discount text e.g. "10%" or "500". */
  discount_text?: string | null;
  vat_type?: VatCalculationType;
  vat_rate?: number;
  /** Precomputed summary from UI — server revalidates before insert. */
  total_amount?: number;
  discount_amount?: number;
  net_before_vat?: number;
  vat_amount?: number;
  grand_total?: number;
};

export type CreateDraftDocumentResult = {
  data: {
    document_id: string;
    document_no: string;
  } | null;
  error: string | null;
};

export type UpdateDraftDocumentInput = {
  document_id: string;
  contact_id: string;
  contact_person_id?: string | null;
  doc_date?: string | null;
  items?: CreateDraftDocumentItemInput[];
  discount_text?: string | null;
  vat_type?: VatCalculationType;
  vat_rate?: number;
  /** Remark / หมายเหตุ — maps to `documents.notes`. */
  notes?: string | null;
  total_amount?: number;
  discount_amount?: number;
  net_before_vat?: number;
  vat_amount?: number;
  grand_total?: number;
};

export type UpdateDraftDocumentResult = {
  data: {
    document_id: string;
    document_no: string;
  } | null;
  error: string | null;
};

export type GenerateDocumentNumberResult = {
  data: string | null;
  error: string | null;
};

export type GetCustomersResult = {
  data: CustomerOption[];
  error: string | null;
};

export type GetContactPersonsResult = {
  data: ContactPersonOption[];
  error: string | null;
};

/** Product row returned by `searchProductsForSales` (includes Cost Snapshot fields). */
export type SalesProductSearchItem = {
  id: string;
  sku: string;
  /** Selling unit price — mapped from `products.retail_price`. */
  unit_price: number;
  /** Cost Snapshot source — `products.cost_price`. */
  cost_price: number;
  display_name: string;
  model_name: string | null;
  color_name: string | null;
  size_label: string | null;
  base_uom: string | null;
  /** Public URL จาก `product_models.image_url` (Visual Verification). */
  image_url: string | null;
};

export type SearchProductsForSalesResult = {
  data: SalesProductSearchItem[];
  error: string | null;
};

/** Client-side line item before `completeDocument`. */
export type SalesLineItem = {
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
  /** Snapshot จาก product_models.image_url ตอนเลือกสินค้า */
  image_url: string | null;
};

export type CompleteDocumentLineInput = {
  product_id: string;
  description?: string;
  qty: number;
  uom_used?: string;
  unit_price: number;
  discount_text?: string;
  discount_amount?: number;
  /** Line total after discount — trusted for header rollup this phase. */
  line_total: number;
  sort_order?: number;
};

export type CompleteDocumentInput = {
  document_id: string;
  items: CompleteDocumentLineInput[];
};

export type CompleteDocumentResult = {
  data: {
    document_id: string;
    doc_no: string;
    status: DocumentStatus;
    item_count: number;
    ledger_count: number;
    grand_total: number;
    pending_approval?: boolean;
    successMessage?: string;
  } | null;
  error: string | null;
};

export type DocumentDetailContact = {
  id: string;
  company_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  branch_code: string | null;
};

export type DocumentDetailContactPerson = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  department_or_role: string | null;
};

export type DocumentDetailItem = {
  id: string;
  product_id: string | null;
  description: string | null;
  qty: number;
  uom_used: string | null;
  unit_price: number;
  unit_cost_price: number;
  discount_text: string | null;
  discount_amount: number;
  line_total: number;
  sort_order: number;
  sku: string | null;
  product_name: string | null;
  /** จาก products → product_models.image_url */
  image_url: string | null;
};

/** Child document that references this row via `ref_document_id` (lineage). */
export type DocumentLineageChild = {
  id: string;
  doc_no: string;
  doc_type: DocumentType;
  status: DocumentStatus;
};

export type DocumentDetail = {
  id: string;
  doc_no: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  doc_date: string;
  due_date: string | null;
  contact_id: string;
  contact_person_id: string | null;
  /**
   * When set, this DRAFT is a Cancel & Replace clone.
   * Edit UI/server may only change customer/contact (not line items / amounts).
   */
  ref_document_id: string | null;
  sub_total: number;
  discount_amount: number;
  discount_text: string | null;
  tax_rate: number;
  tax_amount: number;
  grand_total: number;
  /**
   * Deposit Allocation — ยอดมัดจำที่ถูกนำไปหักในเอกสารนี้
   * (`documents.deposit_deducted`, DECIMAL NOT NULL DEFAULT 0).
   */
  deposit_deducted: number;
  /** Cumulative knock-off / cash paid — void blocked when > 0. */
  paid_amount: number;
  vat_type: VatCalculationType | null;
  vat_rate: number | null;
  total_amount: number | null;
  net_before_vat: number | null;
  vat_amount: number | null;
  wht_amount: number;
  payment_status: string;
  notes: string | null;
  /** Vendor invoice / external reference — parsed from notes when no DB column. */
  reference_no: string | null;
  attachment_url: string | null;
  attached_file_url: string | null;
  /** Scanned WHT certificate (REC). */
  wht_attachment_url: string | null;
  /** Scanned original vendor receipt / tax invoice (PAY). */
  original_receipt_url: string | null;
  created_at: string;
  updated_at: string;
  contact: DocumentDetailContact | null;
  contact_person: DocumentDetailContactPerson | null;
  items: DocumentDetailItem[];
  /**
   * Documents that point at this one via `documents.ref_document_id`
   * (e.g. QT → INV_DO). Used to lock further conversion.
   */
  child_documents: DocumentLineageChild[];
};

export type GetDocumentByNoResult = {
  data: DocumentDetail | null;
  error: string | null;
};

export type IssueDocumentResult = {
  data: {
    document_id: string;
    document_no: string;
    status: DocumentStatus;
    ledger_count: number;
    pending_approval?: boolean;
    successMessage?: string;
  } | null;
  error: string | null;
};

export type VoidDocumentResult = {
  data: {
    document_id: string;
    document_no: string;
    status: DocumentStatus;
    reversed_ledger_count: number;
  } | null;
  error: string | null;
};

export type CloneDocumentToNewDraftResult = {
  data: {
    document_id: string;
    document_no: string;
    ref_document_id: string;
  } | null;
  error: string | null;
};

/** Repeat-order copy — no lineage (`ref_document_id` left null). */
export type DuplicateDocumentResult = {
  data: {
    document_id: string;
    document_no: string;
  } | null;
  error: string | null;
};

export type SalesDocumentListItem = {
  id: string;
  doc_no: string;
  doc_type: DocumentType;
  status: DocumentStatus;
  doc_date: string;
  created_at: string;
  grand_total: number;
  contact_id: string;
  customer_name: string | null;
};

export type SalesDocumentFilters = {
  search?: string;
  from?: string;
  to?: string;
};

/** Shared list filters (sales + purchase) — same shape as URL search params. */
export type DocumentListFilters = SalesDocumentFilters;

export type GetSalesDocumentsResult = {
  data: SalesDocumentListItem[];
  error: string | null;
};

export type PurchaseDocumentListItem = {
  id: string;
  doc_no: string;
  /** Vendor invoice / external reference — parsed from notes when no DB column. */
  reference_no: string | null;
  doc_type: DocumentType;
  status: DocumentStatus;
  doc_date: string;
  created_at: string;
  grand_total: number;
  contact_id: string;
  vendor_name: string | null;
};

export type GetPurchaseDocumentsResult = {
  data: PurchaseDocumentListItem[];
  error: string | null;
};

export type ConvertTargetDocType = "SO" | "INV_DO" | "TAX_INV" | "CS_TAX" | "ABB";

export type ConvertDocumentResult = {
  data: {
    document_id: string;
    doc_no: string;
    doc_type: ConvertTargetDocType;
  } | null;
  error: string | null;
};

export type UploadDocumentImageResult = {
  data: {
    url: string;
    path: string;
  } | null;
  error: string | null;
};
