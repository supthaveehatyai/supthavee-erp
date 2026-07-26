/**
 * Normalize vendor SKU for OCR ↔ mapping comparison.
 * UPPERCASE + trim + collapse multiple spaces.
 */
export function normalizeVendorSku(sku: string): string {
  return sku.trim().toUpperCase().replace(/\s+/g, " ");
}
