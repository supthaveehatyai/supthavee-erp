/**
 * Phase 14 — Inventory Adjustment (STK_OB / STK_ADJ).
 * Keep outside `"use server"` modules.
 */

import type { InventoryDocType } from "@/lib/constants/document";

export type InventoryAdjustmentLineInput = {
  product_id: string;
  /** STK_OB: qty > 0 (IN). STK_ADJ: signed (+ IN / − OUT). */
  qty: number;
  /** Cost per unit — required for STK_OB; optional on STK_ADJ IN lines. */
  unit_cost_price?: number;
};

export type AdjustInventoryInput = {
  doc_type: InventoryDocType;
  doc_date: string;
  /** Required for STK_ADJ. Optional notes for STK_OB. */
  remark?: string;
  lines: InventoryAdjustmentLineInput[];
};

export type AdjustInventoryResult =
  | {
      success: true;
      document_id: string;
      doc_no: string;
      pending_approval?: boolean;
      successMessage?: string;
      error?: null;
    }
  | { success: false; error: string; document_id?: null; doc_no?: null };

export type InventoryAdjustmentListItem = {
  id: string;
  doc_no: string;
  doc_type: InventoryDocType;
  status: string;
  doc_date: string;
  remark: string | null;
  line_count: number;
  total_in_qty: number;
  total_out_qty: number;
  created_at: string;
};

export type GetInventoryAdjustmentsResult = {
  data: InventoryAdjustmentListItem[];
  error: string | null;
};

/** Detail view — document header + line items with product info. */
export type AdjustmentDetailItem = {
  id: string;
  product_id: string;
  sku: string;
  product_name: string;
  color: string | null;
  size: string | null;
  qty: number;
  unit_cost_price: number;
  line_total: number;
  sort_order: number;
};

export type AdjustmentDetail = {
  id: string;
  doc_no: string;
  doc_type: InventoryDocType;
  status: string;
  doc_date: string;
  remark: string | null;
  created_at: string;
  items: AdjustmentDetailItem[];
};

export type GetAdjustmentDetailResult = {
  data: AdjustmentDetail | null;
  error: string | null;
};

/** Draft line in the adjustment form (from Matrix picker). */
export type AdjustmentFormLine = {
  product_id: string;
  sku: string;
  display_name: string;
  stock_balance: number;
  qty: string;
  unit_cost_price: string;
};
