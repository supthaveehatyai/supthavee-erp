import type { PrintPaperSize } from "@/types/print-document";
import { normalizePrintPaperSize } from "@/lib/constants/print-paper-size";

export const TAXONOMY_PAPER_STORAGE_KEY = "stv.mst_document_taxonomy";

export function writeLocalTaxonomyPaper(docType: string, paperSize: string): void {
  if (typeof window === "undefined") return;
  const code = docType.trim().toUpperCase();
  const size = normalizePrintPaperSize(paperSize);
  if (!code || !size) return;
  const current = readLocalTaxonomyPapers();
  current[code] = size;
  window.localStorage.setItem(TAXONOMY_PAPER_STORAGE_KEY, JSON.stringify(current));
}

export function readLocalTaxonomyPapers(): Record<string, PrintPaperSize> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(TAXONOMY_PAPER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, string>;
    const out: Record<string, PrintPaperSize> = {};
    for (const [key, value] of Object.entries(parsed)) {
      const size = normalizePrintPaperSize(value);
      if (size) out[key.trim().toUpperCase()] = size;
    }
    return out;
  } catch {
    return {};
  }
}
