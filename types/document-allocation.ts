/**
 * Phase 5 — Document allocation rows for PAY / REC detail views.
 */

export type DocumentAllocationRow = {
  id: string;
  invoice_doc_id: string;
  /** Internal running number of the allocated invoice (e.g. APT-2606-0001). */
  target_doc_no: string;
  /** Target document type (INV_DO, DEP_IN, AP_TAX, …). */
  target_doc_type: string;
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

/** History of how a DEP_IN / DEP_OUT was applied / refunded / written off. */
export type DepositAllocationActionType =
  | "APPLY"
  | "REFUND"
  | "WRITE_OFF";

export type DepositAllocationHistoryRow = {
  id: string;
  applied_date: string;
  receipt_doc_id: string;
  receipt_doc_no: string;
  receipt_doc_type: string;
  /** Invoice doc numbers knocked off in the same REC/PAY (empty for refund/write-off). */
  related_invoice_doc_nos: string[];
  allocated_amount: number;
  /** APPLY = cut against REC/PAY; REFUND / WRITE_OFF = balance settlement. */
  action_type: DepositAllocationActionType;
  /** Remark from adjustment_reason or stub document notes. */
  remark: string | null;
};

export type GetDepositAllocationHistoryResult = {
  data: DepositAllocationHistoryRow[];
  error: string | null;
};

export type UpdateReceiptStatusResult = {
  success: boolean;
  error: string | null;
};
