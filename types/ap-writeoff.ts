/**
 * AP Write-off (ใบสำคัญตัดหนี้สูญเจ้าหนี้) — types kept outside `"use server"`.
 */

export type ApWriteoffAllocatedItem = {
  document_id: string;
  writeoff_amount: number;
};

export type CreateApWriteoffPayload = {
  contact_id: string;
  remark: string;
  allocated_items: ApWriteoffAllocatedItem[];
};

export type OutstandingApDocument = {
  id: string;
  doc_no: string;
  doc_type: string;
  doc_date: string;
  status: string;
  payment_status: string;
  contact_id: string;
  contact_name: string;
  grand_total: number;
  allocated_amount: number;
  remaining_balance: number;
};

export type GetOutstandingApResult = {
  success: boolean;
  data: OutstandingApDocument[];
  error: string | null;
};

export type CreateApWriteOffData = {
  document_id: string;
  document_no: string;
  grand_total: number;
  settled_invoice_ids: string[];
  pending_approval: boolean;
  approval_limit: number;
};

export type CreateAPWriteOffResult = {
  success: boolean;
  data: CreateApWriteOffData | null;
  error: string | null;
};

/** @deprecated ใช้ CreateAPWriteOffResult — คงไว้เพื่อความเข้ากันได้กับฟอร์มเดิม */
export type CreateApWriteoffResult = {
  success: boolean;
  error: string | null;
  document_id?: string;
  document_no?: string;
  grand_total?: number;
  settled_invoice_ids?: string[];
  pending_approval?: boolean;
};

/** สถานะที่แสดงบนหน้ารายการ — PENDING มาจาก `approval_status` ขณะที่ header ยัง DRAFT */
export type ApWriteoffListStatus = "DRAFT" | "PENDING" | "ISSUED" | "VOID";

export type ApWriteoffListItem = {
  id: string;
  doc_no: string;
  doc_date: string;
  created_at: string;
  created_by_name: string;
  grand_total: number;
  remark: string | null;
  status: string;
  approval_status: string;
  list_status: ApWriteoffListStatus;
};

export type ListApWriteoffsResult = {
  success: boolean;
  data: ApWriteoffListItem[];
  error: string | null;
};

export function resolveApWriteoffListStatus(
  status: string,
  approvalStatus: string,
): ApWriteoffListStatus {
  const documentStatus = status.trim().toUpperCase();
  const approval = approvalStatus.trim().toUpperCase();
  if (documentStatus === "VOID" || documentStatus === "CANCELLED") {
    return "VOID";
  }
  if (approval === "PENDING" || documentStatus === "PENDING") {
    return "PENDING";
  }
  if (
    documentStatus === "ISSUED" ||
    documentStatus === "PAID" ||
    documentStatus === "COMPLETED"
  ) {
    return "ISSUED";
  }
  return "DRAFT";
}
