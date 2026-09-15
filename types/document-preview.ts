/**
 * Approval Center — document preview slide-over types.
 * Keep outside `"use server"` modules.
 */

export type DocumentPreviewLineItem = {
  id: string;
  description: string | null;
  qty: number;
  unit_price: number;
  line_total: number;
};

export type DocumentPreviewAllocation = {
  id: string;
  target_doc_no: string;
  target_doc_type: string;
  allocated_amount: number;
  adjustment_reason: string | null;
};

export type DocumentPreview = {
  id: string;
  doc_no: string;
  doc_type: string;
  doc_date: string;
  status: string;
  approval_status: string;
  grand_total: number;
  remark: string | null;
  notes: string | null;
  contact_name: string | null;
  detail_href: string;
  attachment_url?: string | null;
  attached_file_url?: string | null;
  items: DocumentPreviewLineItem[];
  allocations: DocumentPreviewAllocation[];
};

export type GetDocumentPreviewResult = {
  data: DocumentPreview | null;
  error: string | null;
};
