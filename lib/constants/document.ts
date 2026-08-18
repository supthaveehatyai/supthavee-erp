/**
 * Document type constants — Sales / Purchases architecture.
 * Kept outside `"use server"` modules — Next.js only allows async function exports there.
 */

/** Canonical document types (DB enum `public.document_type`). */
export const DOCUMENT_TYPES = [
  // Sales
  "QT",
  "SO",
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
  "ABB",
  "DEP_IN",
  "REC",
  "CN",
  "AR_REFUND",
  "AR_WRITEOFF",
  // Purchases
  "PO",
  "AP_TAX",
  "AP_INV",
  "AP_CASH",
  "DEP_OUT",
  "PAY",
  "AP_REFUND",
  "AP_WRITEOFF",
  // Legacy settlement (readable until fully migrated)
  "REFUND",
  "WRITE_OFF",
  // Technician Billing (documents.doc_type)
  "TB",
  // Legacy (readable until fully migrated)
  "DEP",
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

/** Running-number prefix per type → `{PREFIX}-{YYMM}-{XXXX}`. */
export const DOCUMENT_TYPE_PREFIX = {
  QT: "QT",
  SO: "SO",
  INV_DO: "DO",
  TAX_INV: "INV",
  CS_TAX: "CS",
  ABB: "ABB",
  DEP_IN: "DIN",
  REC: "REC",
  CN: "CN",
  AR_REFUND: "SRF",
  AR_WRITEOFF: "SWO",
  PO: "PO",
  AP_TAX: "APT",
  AP_INV: "API",
  AP_CASH: "APC",
  DEP_OUT: "DOUT",
  PAY: "PAY",
  AP_REFUND: "PRF",
  AP_WRITEOFF: "PWO",
  // Legacy
  REFUND: "RFD",
  WRITE_OFF: "WRO",
  TB: "TB",
  DEP: "DEP",
  INT_REC: "INT",
} as const;

/**
 * Sales Document List — strict allow-list.
 */
export const SALES_DOC_TYPES = [
  "QT",
  "SO",
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
  "ABB",
  "DEP_IN",
  "REC",
  "CN",
  "AR_REFUND",
  "AR_WRITEOFF",
] as const;

/**
 * Purchases Document List — strict allow-list.
 */
export const PURCHASE_DOC_TYPES = [
  "PO",
  "AP_TAX",
  "AP_INV",
  "AP_CASH",
  "DEP_OUT",
  "PAY",
  "AP_REFUND",
  "AP_WRITEOFF",
] as const;

/** AR settlement docs (Sales / DEP_IN). */
export const AR_SETTLEMENT_DOC_TYPES = ["AR_REFUND", "AR_WRITEOFF"] as const;

/** AP settlement docs (Purchases / DEP_OUT). */
export const AP_SETTLEMENT_DOC_TYPES = ["AP_REFUND", "AP_WRITEOFF"] as const;

/** All deposit settlement docs (AR + AP + legacy). */
export const SETTLEMENT_DOC_TYPES = [
  "AR_REFUND",
  "AR_WRITEOFF",
  "AP_REFUND",
  "AP_WRITEOFF",
  "REFUND",
  "WRITE_OFF",
] as const;

/**
 * Smart Goods Receipt / Manual Receipt — vendor bill types only.
 */
export const GOODS_RECEIPT_DOC_TYPES = [
  "AP_TAX",
  "AP_INV",
  "AP_CASH",
] as const;

export type GoodsReceiptDocType = (typeof GOODS_RECEIPT_DOC_TYPES)[number];

/**
 * Doc types that deduct stock on complete (sales outflow).
 */
export const STOCK_OUT_DOC_TYPES = [
  "ABB",
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
] as const;

/** Target types allowed by `convertDocument` (QT → sales bill). */
export const CONVERT_TARGET_DOC_TYPES = [
  "INV_DO",
  "TAX_INV",
  "CS_TAX",
  "ABB",
] as const;

/** Credit invoices — open AR/AP until paid (Knock-off). */
export const CREDIT_DOC_TYPES = [
  "INV_DO",
  "TAX_INV",
  "AP_TAX",
  "AP_INV",
] as const;

/** Cash / settled-on-issue documents. */
export const CASH_DOC_TYPES = ["CS_TAX", "ABB", "AP_CASH"] as const;

/** Sales AR invoice types (customer receivables). */
export const AR_INVOICE_DOC_TYPES = ["INV_DO", "TAX_INV"] as const;

export type FinancePaymentStatus = "UNPAID" | "PARTIAL" | "PAID";

/**
 * Initial `payment_status` for a document type.
 * Credit → UNPAID; Cash → PAID; others (QT/SO/PO/…) → UNPAID by default.
 */
export function resolveInitialPaymentStatus(
  docType: string,
): FinancePaymentStatus {
  if ((CASH_DOC_TYPES as readonly string[]).includes(docType)) {
    return "PAID";
  }
  if ((CREDIT_DOC_TYPES as readonly string[]).includes(docType)) {
    return "UNPAID";
  }
  // QT / SO / PO / DEP_* / REC / CN / PAY — no open trade receivable by default
  if (docType === "REC" || docType === "PAY") return "PAID";
  return "UNPAID";
}

/**
 * Lifecycle status after issue/save:
 * - QT only → COMPLETED (convertible quotation)
 * - Accounting docs → ISSUED
 */
export function resolveIssuedDocumentStatus(
  docType: string,
): "ISSUED" | "COMPLETED" {
  return docType === "QT" ? "COMPLETED" : "ISSUED";
}
