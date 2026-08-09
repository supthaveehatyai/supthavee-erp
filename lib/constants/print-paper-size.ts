import type { PrintPaperSize } from "@/types/print-document";
import type { DocumentPrintSettings } from "@/types/system-settings";

/**
 * Official print paper size by document / module.
 *
 * Defaults (when system_settings.document_print_settings has no override):
 * A4: QT, TAX_INV, AP_TAX, EXPENSES, WHT (+ tax / formal docs)
 * A5-Landscape: INV_DO, REC, PAY, DEP_IN, DEP_OUT, BN
 *
 * UI labels: A4 · A5 (= A5-Portrait) · A5 Landscape (= A5-Landscape)
 */
const A5_LANDSCAPE_TYPES = new Set([
  "INV_DO",
  "REC",
  "PAY",
  "DEP_IN",
  "DEP_OUT",
  "BN",
  "BR",
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

export const PRINT_PAPER_SIZE_OPTIONS: ReadonlyArray<{
  value: PrintPaperSize;
  label: string;
}> = [
  { value: "A4", label: "A4" },
  { value: "A5-Portrait", label: "A5" },
  { value: "A5-Landscape", label: "A5 Landscape" },
];

export function isPrintPaperSize(value: string): value is PrintPaperSize {
  return (
    value === "A4" || value === "A5-Portrait" || value === "A5-Landscape"
  );
}

/**
 * Normalize UI / legacy aliases → canonical PrintPaperSize.
 * "A5" → A5-Portrait · "A5 Landscape" / "A5-Landscape" → A5-Landscape
 */
export function normalizePrintPaperSize(
  value: string | null | undefined,
): PrintPaperSize | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, "-");
  if (compact === "A4") return "A4";
  if (
    compact === "A5" ||
    compact === "A5-Portrait" ||
    compact.toLowerCase() === "a5-portrait"
  ) {
    return "A5-Portrait";
  }
  if (
    compact === "A5-Landscape" ||
    compact.toLowerCase() === "a5-landscape"
  ) {
    return "A5-Landscape";
  }
  return null;
}

function defaultPrintPaperSize(docType: string): PrintPaperSize {
  if (A5_LANDSCAPE_TYPES.has(docType)) {
    return "A5-Landscape";
  }
  if (A4_TYPES.has(docType)) {
    return "A4";
  }
  return "A4";
}

/**
 * Resolve paper size for a document type.
 * Priority: system_settings.document_print_settings[docType] → built-in default → A4
 */
export function resolvePrintPaperSize(
  docType: string | null | undefined,
  overrides?: DocumentPrintSettings | null,
): PrintPaperSize {
  const normalized = String(docType ?? "")
    .trim()
    .toUpperCase();

  if (normalized && overrides) {
    const fromSettings =
      overrides[normalized] ??
      overrides[docType ?? ""] ??
      overrides[String(docType ?? "").trim()];
    const parsed = normalizePrintPaperSize(fromSettings);
    if (parsed) return parsed;
  }

  if (!normalized) return "A4";
  return defaultPrintPaperSize(normalized);
}
