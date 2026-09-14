/**
 * AR Write-off (ใบสำคัญตัดหนี้สูญ) — types kept outside `"use server"`.
 */

export type ArWriteoffAllocatedItem = {
  document_id: string;
  writeoff_amount: number;
};

export type CreateArWriteoffPayload = {
  contact_id: string;
  remark: string;
  allocated_items: ArWriteoffAllocatedItem[];
};

export type CreateArWriteoffResult = {
  success: boolean;
  error: string | null;
  document_id?: string;
  document_no?: string;
  grand_total?: number;
  settled_invoice_ids?: string[];
  pending_approval?: boolean;
};
