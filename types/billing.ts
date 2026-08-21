/**
 * Phase 5 — Billing Note (BN / BR) types (shared by Server Actions + UI).
 * Kept outside `"use server"` modules — Next.js only allows async function
 * exports from Server Action files.
 */

export type BillingCategory = "AR" | "AP";

export type UnbilledInvoice = {
  id: string;
  doc_no: string;
  doc_type: string;
  doc_date: string;
  due_date: string | null;
  grand_total: number;
  paid_amount: number;
  outstanding_amount: number;
  payment_status: string | null;
};

export type GetUnbilledInvoicesResult = {
  data: UnbilledInvoice[];
  error: string | null;
};

export type CreateBillingNoteInput = {
  contactId: string;
  category: BillingCategory;
  invoiceIds: string[];
  totalBilledAmount: number;
  documentDate: string;
  dueDate: string;
  remark?: string;
};

export type CreateBillingNoteResult =
  | { success: true; documentId: string; error?: null }
  | { success: false; documentId?: null; error: string };

/** Listing tab — BN (AR Billing Note) | BR (AP Bill Receipt). */
export type BillingNoteDocType = "BN" | "BR";

export type BillingNoteListItem = {
  id: string;
  doc_no: string;
  doc_type: BillingNoteDocType;
  doc_date: string;
  due_date: string | null;
  contact_id: string;
  contact_name: string;
  grand_total: number;
  payment_status: string;
};

export type GetBillingNotesResult = {
  data: BillingNoteListItem[];
  error: string | null;
};

export type BillingNoteContact = {
  id: string;
  company_name: string;
  tax_id: string | null;
  address: string | null;
  phone: string | null;
  branch_code: string | null;
  contact_roles: string[] | null;
};

export type BillingNoteInvoiceLine = {
  id: string;
  invoice_id: string;
  billed_amount: number;
  invoice_doc_no: string;
  invoice_doc_type: string;
  invoice_doc_date: string;
  invoice_due_date: string | null;
  invoice_grand_total: number;
};

export type BillingNoteDetailData = {
  id: string;
  doc_no: string;
  doc_type: BillingNoteDocType;
  doc_date: string;
  due_date: string | null;
  grand_total: number;
  payment_status: string;
  contact: BillingNoteContact | null;
  invoices: BillingNoteInvoiceLine[];
};

export type GetBillingNoteByIdResult = {
  data: BillingNoteDetailData | null;
  error: string | null;
};

export type OutstandingContactSummary = {
  contact_id: string;
  contact_name: string;
  invoice_count: number;
  total_outstanding: number;
};

export type GetOutstandingContactsSummaryResult = {
  data: OutstandingContactSummary[];
  error: string | null;
};

export type OpenBillingNoteOption = {
  id: string;
  doc_no: string;
  doc_type: BillingNoteDocType;
  doc_date: string;
  due_date: string | null;
  grand_total: number;
  payment_status: string;
  invoice_count: number;
};

export type GetOpenBillingNotesResult = {
  data: OpenBillingNoteOption[];
  error: string | null;
};

export type BillingNoteLinkedInvoice = {
  /** Primary ledger `documents.id` — use for REC/PAY knock-off. */
  id: string;
  /** Legacy `doc_headers.id` from billing_note_items.invoice_id. */
  header_id: string;
  doc_no: string;
  doc_type: string;
  doc_date: string;
  due_date: string | null;
  grand_total: number;
  paid_amount: number;
  outstanding: number;
  payment_status: string;
  contact_id: string;
};

export type GetInvoicesByBillingNoteResult = {
  data: BillingNoteLinkedInvoice[];
  error: string | null;
  billing_note?: {
    id: string;
    doc_no: string;
    doc_type: BillingNoteDocType;
    contact_id: string;
  } | null;
};
