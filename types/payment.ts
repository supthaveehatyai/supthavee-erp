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

export type UnpaidInvoice = {
  id: string;
  display_doc_no: string;
  document_date: string;
  doc_type: string;
  payment_status: string;
  net_amount_calc: number;
  paid_amount: number;
  /**
   * Face-value remaining = grand_total − paid_amount.
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
