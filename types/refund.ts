/**
 * Refund Management (คืนเงินมัดจำ) — types kept outside `"use server"`.
 */

import type { VatCalculationType } from "@/lib/utils/document-summary";

export type RefundSide = "AR" | "AP";

export type RefundDocType = "AR_REFUND" | "AP_REFUND";

export type RefundDepositDocType = "DEP_IN" | "DEP_OUT";

/** มัดจำที่ยังมียอดคงเหลือ (grand_total − Σ allocated_amount) */
export type RefundableDeposit = {
  id: string;
  doc_no: string;
  document_date: string;
  doc_type: RefundDepositDocType;
  contact_id: string;
  grand_total: number;
  /** Σ `document_allocations.allocated_amount` ที่ invoice_doc_id = มัดจำนี้ */
  allocated_amount: number;
  remaining_balance: number;
  vat_type: VatCalculationType;
  vat_rate: number;
};

export type GetAvailableDepositsResult = {
  success: boolean;
  data: RefundableDeposit[];
  error: string | null;
};

/** คู่ค้าที่มียอดมัดจำคงเหลือ — ใช้กับ Smart Combobox */
export type RefundPartyOption = {
  id: string;
  name: string;
  /** ยอดมัดจำคงเหลือรวม */
  outstanding_total: number;
  /** จำนวนใบมัดจำที่ยังเหลือ */
  invoice_count: number;
};

export type GetRefundPartiesResult = {
  success: boolean;
  data: RefundPartyOption[];
  error: string | null;
};

export type CreateRefundDocumentPayload = {
  type: RefundSide;
  contact_id: string;
  deposit_id: string;
  amount: number;
  remark?: string | null;
  document_date?: string | null;
  /** UUID จาก `mst_bank_accounts` หรือ `"CASH"` */
  bank_account_id: string;
  slip_file?: File | null;
};

export type CreateRefundDocumentData = {
  document_id: string;
  document_no: string;
  doc_type: RefundDocType;
  grand_total: number;
  net_before_vat: number;
  vat_amount: number;
  vat_type: VatCalculationType;
  vat_rate: number;
  pending_approval: boolean;
  approval_limit: number;
};

export type CreateRefundDocumentResult = {
  success: boolean;
  error: string | null;
  data?: CreateRefundDocumentData | null;
};
