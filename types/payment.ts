/**
 * Phase 5 — Payment / debtor list types.
 * Kept outside `"use server"` modules.
 */

import type {
  AvailableDeposit,
  DepositAllocationInput,
} from "@/types/available-deposit";

export type { AvailableDeposit, DepositAllocationInput };

export type DebtorOption = {
  id: string;
  name: string;
  /** Sum of remaining balances across open AR invoices (> 0 only). */
  outstanding_total: number;
  invoice_count: number;
  /** Remaining amount on invoices past due (Server-calculated). */
  overdue_amount: number;
  /** Oldest open invoice document_date (YYYY-MM-DD). */
  oldest_invoice_date: string | null;
};

export type InvoiceAllocationSource = {
  doc_no: string;
  amount: number;
  doc_type: string;
};

export type UnpaidInvoice = {
  id: string;
  display_doc_no: string;
  document_date: string;
  doc_type: string;
  payment_status: string;
  /** ยอดบิลเต็ม (Gross) — `documents.grand_total` */
  grand_total: number;
  /** @deprecated ใช้ `grand_total` — คงไว้เพื่อความเข้ากันได้กับฟอร์มเดิม */
  net_amount_calc: number;
  paid_amount: number;
  /** Σ `document_allocations.allocated_amount` ของบิลนี้ */
  allocated_amount: number;
  /** รายการเอกสารที่ตัดหนี้ (REC / CN / PWO / PAY) */
  allocation_sources: InvoiceAllocationSource[];
  /**
   * ยอดค้างสุทธิ = grand_total − allocated_amount.
   * Always unsigned (positive). Credit notes (CN) keep the same sign —
   * never multiplied by -1 at query / DB level.
   */
  remaining_balance: number;
  contact_id: string;
};

export type CustomerPaymentContext = {
  invoices: UnpaidInvoice[];
  availableDeposits: AvailableDeposit[];
};

export type KnockoffAllocationInput = {
  invoice_id: string;
  allocated_amount: number;
  wht_amount: number;
};

export type ProcessPaymentKnockoffResult = {
  success: boolean;
  error: string | null;
  receipt_doc_no?: string | null;
};
