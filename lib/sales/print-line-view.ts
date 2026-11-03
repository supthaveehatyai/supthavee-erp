import type { DocumentDetailItem } from "@/types/document";
import { displayDocumentItemDescription } from "@/lib/utils/credit-note-line";

export type PrintNameMode = "short" | "sku";

export type PrintLineRow = {
  key: string;
  sku: string;
  description: string;
  qty: number;
  uom_used: string;
  unit_price: number;
  line_total: number;
};

const TAX_PRINT_DOC_TYPES = new Set(["TAX_INV", "CS_TAX", "ABB"]);

export function defaultPrintNameMode(docType: string): PrintNameMode {
  return TAX_PRINT_DOC_TYPES.has(docType) ? "short" : "sku";
}

export function defaultHideZeroServiceLines(docType: string): boolean {
  return TAX_PRINT_DOC_TYPES.has(docType);
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function netUnitPrice(item: DocumentDetailItem): number {
  const qty = Number(item.qty ?? 0);
  if (qty > 0) return roundMoney(Number(item.line_total ?? 0) / qty);
  return roundMoney(Number(item.unit_price ?? 0));
}

function shortLabel(item: DocumentDetailItem): string {
  const shortName = item.model_short_name?.trim() || "";
  if (shortName) return shortName;
  const category = item.category_name?.trim() || "";
  if (category) return category;
  return (
    displayDocumentItemDescription(item.description, item.product_name) ||
    item.sku ||
    "รายการ"
  );
}

function isZeroServiceLine(item: DocumentDetailItem): boolean {
  return item.is_service_item === true && Math.abs(Number(item.line_total ?? 0)) < 0.005;
}

export function buildPrintLineRows(
  items: DocumentDetailItem[],
  mode: PrintNameMode,
  hideZeroServiceLines: boolean,
): PrintLineRow[] {
  const visible = hideZeroServiceLines
    ? items.filter((item) => !isZeroServiceLine(item))
    : items;

  if (mode === "sku") {
    return visible.map((item) => ({
      key: item.id,
      sku: item.product_id ? item.sku?.trim() || "—" : "SERVICE",
      description: displayDocumentItemDescription(item.description, item.product_name),
      qty: Number(item.qty ?? 0),
      uom_used: item.uom_used?.trim() || "—",
      unit_price: Number(item.unit_price ?? 0),
      line_total: Number(item.line_total ?? 0),
    }));
  }

  const groups = new Map<string, PrintLineRow & { count: number }>();
  for (const item of visible) {
    const label = shortLabel(item);
    const unit = netUnitPrice(item);
    const uom = item.uom_used?.trim() || "—";
    const key = `${label}|${uom}|${unit.toFixed(2)}`;
    const existing = groups.get(key);
    if (existing) {
      existing.qty = roundMoney(existing.qty + Number(item.qty ?? 0));
      existing.line_total = roundMoney(existing.line_total + Number(item.line_total ?? 0));
      existing.count += 1;
      existing.sku = "รวม";
      continue;
    }
    groups.set(key, {
      key,
      sku: item.product_id ? item.sku?.trim() || "—" : "SERVICE",
      description: label,
      qty: Number(item.qty ?? 0),
      uom_used: uom,
      unit_price: unit,
      line_total: Number(item.line_total ?? 0),
      count: 1,
    });
  }

  return [...groups.values()].map(({ count: _count, ...row }) => row);
}
