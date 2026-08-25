/**
 * Phase 14 — Maker-Checker approval routing rules.
 * Shared by document / expense Server Actions (no "use server" here).
 */

import type { Database } from "@/src/types/supabase";

export type ApprovalStatus = Database["public"]["Enums"]["approval_status"];

/** Document types that require Admin approval before accounting impact. */
export const APPROVAL_PENDING_DOCUMENT_TYPES = [
  "STK_ADJ",
  "AR_WRITEOFF",
  "AP_WRITEOFF",
] as const;

export type ApprovalPendingDocumentType =
  (typeof APPROVAL_PENDING_DOCUMENT_TYPES)[number];

/** Expenses above this grand_total (THB) enter Approval Center. */
export const EXPENSE_APPROVAL_THRESHOLD = 5000;

export const PENDING_APPROVAL_TOAST_MESSAGE =
  "เอกสารเข้าสู่สถานะรออนุมัติแล้ว";

export const APPROVAL_LIMIT_EXCEEDED_MESSAGE =
  "Forbidden: วงเงินอนุมัติของคุณไม่เพียงพอสำหรับเอกสารฉบับนี้";

function toLimitMoney(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

/**
 * ABAC — ยอดเอกสารต้องไม่เกินวงเงินอนุมัติของผู้อนุมัติ (`user_profiles.approval_limit`).
 * 0 = ไม่มีวงเงินอนุมัติ (ห้ามอนุมัติยอดที่มากกว่า 0).
 */
export function exceedsApprovalLimit(
  grandTotal: number | string | null | undefined,
  approvalLimit: number | string | null | undefined,
): boolean {
  return toLimitMoney(grandTotal) > toLimitMoney(approvalLimit);
}

export function requiresDocumentApproval(docType: string): boolean {
  return (APPROVAL_PENDING_DOCUMENT_TYPES as readonly string[]).includes(
    docType,
  );
}

export function resolveDocumentApprovalStatus(
  docType: string,
): ApprovalStatus {
  return requiresDocumentApproval(docType) ? "PENDING" : "APPROVED";
}

export function requiresExpenseApproval(
  grandTotal: number | string | null | undefined,
): boolean {
  const total = Number(grandTotal ?? 0);
  return Number.isFinite(total) && total > EXPENSE_APPROVAL_THRESHOLD;
}

export function resolveExpenseApprovalStatus(
  grandTotal: number | string | null | undefined,
): ApprovalStatus {
  return requiresExpenseApproval(grandTotal) ? "PENDING" : "APPROVED";
}

export function isPendingApprovalStatus(status: ApprovalStatus): boolean {
  return status === "PENDING";
}

export function buildIssueSuccessMessage(
  documentNo: string,
  pendingApproval: boolean,
  options?: { ledgerCount?: number },
): string {
  if (pendingApproval) {
    return PENDING_APPROVAL_TOAST_MESSAGE;
  }

  const base = `ออกเอกสาร ${documentNo} สำเร็จ`;
  const ledgerCount = options?.ledgerCount ?? 0;
  if (ledgerCount > 0) {
    return `${base} — ตัดสต็อก ${ledgerCount} รายการ`;
  }
  return base;
}

export function approvalStatusFields(docType: string): {
  approval_status: ApprovalStatus;
  approved_by: null;
  approved_at: null;
} {
  return {
    approval_status: resolveDocumentApprovalStatus(docType),
    approved_by: null,
    approved_at: null,
  };
}

export function expenseApprovalStatusFields(
  grandTotal: number | string | null | undefined,
): {
  approval_status: ApprovalStatus;
  approved_by: null;
  approved_at: null;
} {
  return {
    approval_status: resolveExpenseApprovalStatus(grandTotal),
    approved_by: null,
    approved_at: null,
  };
}
