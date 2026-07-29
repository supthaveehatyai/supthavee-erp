/**
 * Phase 5 — Document allocation rows for PAY / REC detail views.
 */

export type DocumentAllocationRow = {
  id: string;
  invoice_doc_id: string;
  /** Internal running number of the allocated invoice (e.g. APT-2606-0001). */
  target_doc_no: string;
  /** Vendor / external reference when available. */
  reference_no: string | null;
  allocated_amount: number;
  wht_amount: number;
  /** From document_allocations.original_receipt_received */
  original_receipt_received: boolean;
};

export type GetDocumentAllocationsResult = {
  data: DocumentAllocationRow[];
  error: string | null;
};

export type UpdateReceiptStatusResult = {
  success: boolean;
  error: string | null;
};
