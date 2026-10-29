export const TAX_INVOICE_STATUSES = [
  "TAX_READY",
  "PENDING_TAX_INVOICE",
  "CONSOLIDATED_CHILD",
] as const;

export type TaxInvoiceStatus = (typeof TAX_INVOICE_STATUSES)[number];

export type ReceiptTaxInvoiceChoice = "TAX_READY" | "PENDING_TAX_INVOICE";

export function normalizeTaxInvoiceStatus(value: unknown): TaxInvoiceStatus | null {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase();
  if (
    raw === "TAX_READY" ||
    raw === "PENDING_TAX_INVOICE" ||
    raw === "CONSOLIDATED_CHILD"
  ) {
    return raw;
  }
  return null;
}

/** ORNC (กมลกิจ) and the vendor's remembered status start the receipt picker. */
export function suggestReceiptTaxInvoiceStatus(input: {
  referenceNo?: string | null;
  vendorName?: string | null;
  vendorUsesTemporaryBill?: boolean | null;
  defaultTaxInvoiceStatus?: string | null;
}): ReceiptTaxInvoiceChoice {
  const reference = String(input.referenceNo ?? "")
    .trim()
    .toUpperCase();
  if (reference.startsWith("ORNC")) return "PENDING_TAX_INVOICE";
  const remembered = normalizeTaxInvoiceStatus(input.defaultTaxInvoiceStatus);
  if (remembered === "PENDING_TAX_INVOICE" || remembered === "TAX_READY") {
    return remembered;
  }
  if (input.vendorUsesTemporaryBill) return "PENDING_TAX_INVOICE";
  const name = String(input.vendorName ?? "").replace(/\s+/g, "");
  if (
    name.includes("กมลกิจ") ||
    name.includes("ซีพียู") ||
    name.includes("โอไอซี") ||
    name.includes("ขวัญนคร")
  ) {
    return "PENDING_TAX_INVOICE";
  }
  return "TAX_READY";
}

export function roundTaxMoney(value: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}
