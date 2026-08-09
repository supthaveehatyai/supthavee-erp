import type { PrintPaperSize } from "@/types/print-document";

/**
 * Phase 11 — Official print paper size by document / module.
 *
 * A4: QT, TAX_INV, AP_TAX, EXPENSES, WHT (+ tax / formal docs)
 * A5-Landscape: INV_DO, REC, PAY, DEP_IN, DEP_OUT, BN
 */
const A5_LANDSCAPE_TYPES = new Set([
  "INV_DO",
  "REC",
  "PAY",
  "DEP_IN",
  "DEP_OUT",
  "BN",
  "BR", // Bill Receipt — same family as BN
]);

const A4_TYPES = new Set([
  "QT",
  "TAX_INV",
  "AP_TAX",
  "CS_TAX",
  "ABB",
  "CN",
  "PO",
  "AP_INV",
  "AP_CASH",
  "SO",
  "AR_REFUND",
  "AP_REFUND",
  "AR_WRITEOFF",
  "AP_WRITEOFF",
  "EXPENSE",
  "WHT",
]);

export function resolvePrintPaperSize(
  docType: string | null | undefined,
): PrintPaperSize {
  const normalized = String(docType ?? "")
    .trim()
    .toUpperCase();

  if (A5_LANDSCAPE_TYPES.has(normalized)) {
    return "A5-Landscape";
  }

  if (A4_TYPES.has(normalized)) {
    return "A4";
  }

  // Default formal docs → A4
  return "A4";
}
