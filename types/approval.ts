/**
 * Phase 14 — Maker-Checker Approval types.
 * Keep outside `"use server"` modules.
 */

export type ApprovalTargetType = "DOCUMENT" | "EXPENSE";

export type ApprovalDecision = "APPROVED" | "REJECTED";

export type ApprovalTab = "documents" | "expenses";

export type PendingApprovalItem = {
  id: string;
  target_type: ApprovalTargetType;
  document_no: string;
  doc_date: string;
  doc_type: string | null;
  grand_total: number;
  created_by_name: string | null;
  created_by_email: string | null;
  /** Server-resolved detail page for Maker-Checker review. */
  detail_href: string;
};

export type PendingApprovalsPayload = {
  documents: PendingApprovalItem[];
  expenses: PendingApprovalItem[];
};

export type GetPendingApprovalsResult = {
  success: true;
  data: PendingApprovalsPayload;
  error?: null;
} | {
  success: false;
  data: PendingApprovalsPayload;
  error: string;
};

export type ProcessApprovalResult = {
  success: true;
  error?: null;
} | {
  success: false;
  error: string;
};
