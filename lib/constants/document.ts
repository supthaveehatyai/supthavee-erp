/**
 * Phase 4 — Document constants (shared by Server Actions + UI).
 * Kept outside `"use server"` modules — Next.js only allows async function exports there.
 */

export const DOCUMENT_TYPES = [
  "QT",
  "PO",
  "ABB",
  "DEP",
  "INV_DO",
  "REC",
  "TAX_INV",
  "INT_REC",
] as const;

export const DOCUMENT_STATUSES = [
  "DRAFT",
  "ISSUED",
  "COMPLETED",
  "PAID",
  "CANCELLED",
  "VOID",
] as const;

/** Running-number prefix per Blueprint type (e.g. TAX_INV → INV-YYMM-XXXX). */
export const DOCUMENT_TYPE_PREFIX = {
  QT: "QT",
  PO: "PO",
  ABB: "ABB",
  DEP: "DEP",
  INV_DO: "DO",
  REC: "REC",
  TAX_INV: "INV",
  INT_REC: "INT",
} as const;

/**
 * Purchase Document List — strict allow-list (prevents sales INV_DO/TAX_INV leakage).
 */
export const PURCHASE_DOC_TYPES = ["PO", "REC"] as const;

/**
 * Document types selectable on Smart Goods Receipt (Save to Ledger).
 * Note: Purchase List only surfaces PO/REC; INV_DO/TAX_INV here still write Phase 4 docs
 * but are classified as sales-side types for list views.
 */
export const GOODS_RECEIPT_DOC_TYPES = ["REC", "INV_DO", "TAX_INV"] as const;

export type GoodsReceiptDocType = (typeof GOODS_RECEIPT_DOC_TYPES)[number];

/**
 * Doc types that deduct stock on complete (Blueprint Module B + C).
 * QT / DEP / PO do not move inventory.
 */
export const STOCK_OUT_DOC_TYPES = [
  "ABB",
  "INV_DO",
  "TAX_INV",
  "INT_REC",
] as const;

/**
 * Sales Document List — strict allow-list (prevents purchase PO/REC leakage).
 */
export const SALES_DOC_TYPES = ["QT", "ABB", "INV_DO", "TAX_INV"] as const;

/** Target types allowed by `convertDocument` (QT → sales bill). */
export const CONVERT_TARGET_DOC_TYPES = ["INV_DO", "TAX_INV", "ABB"] as const;
