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
  gross_amount: number;
  discount_label: string | null;
};

const TAX_PRINT_DOC_TYPES = new Set(["TAX_INV", "CS_TAX", "ABB", "INV_DO"]);

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

function moneyText(value: number): string {
  return roundMoney(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function lineDiscountPresentation(item: {
  qty: number;
  unit_price: number;
  discount_text?: string | null;
  discount_amount?: number | null;
}): { note: string | null; label: string | null; gross: number } {
  const text = String(item.discount_text ?? "").trim();
  const amount = Number(item.discount_amount ?? 0);
  const gross = roundMoney(Number(item.qty ?? 0) * Number(item.unit_price ?? 0));
  const discounted = amount > 0.005 || text.length > 0;
  if (!discounted) return { note: null, label: null, gross };
  const value = amount > 0.005 ? roundMoney(amount) : gross;
  if (text === "100%") {
    return {
      note: `(แถมฟรี ส่วนลด 100% มูลค่า ${moneyText(value)} ฿)`,
      label: "ลด 100%",
      gross,
    };
  }
  const label = text ? `ลด ${text}` : `ลด ${moneyText(value)} ฿`;
  return {
    note: `(ส่วนลด ${text || moneyText(value)} มูลค่า ${moneyText(value)} ฿)`,
    label,
    gross,
  };
}

function withDiscountNote(description: string, note: string | null): string {
  if (!note || description.includes(note)) return description;
  return `${description} ${note}`.trim();
}

function isZeroServiceLine(item: DocumentDetailItem): boolean {
  return item.is_service_item === true && Math.abs(Number(item.line_total ?? 0)) < 0.005;
}

function rowFromItem(item: DocumentDetailItem, description: string): PrintLineRow {
  const discount = lineDiscountPresentation(item);
  const sku = item.is_bundle_header
    ? item.sku?.trim() || item.model_code?.trim() || "ชุด"
    : item.product_id
      ? item.sku?.trim() || "—"
      : "SERVICE";
  return {
    key: item.id,
    sku,
    description: withDiscountNote(description, discount.note),
    qty: Number(item.qty ?? 0),
    uom_used: item.uom_used?.trim() || "—",
    unit_price: Number(item.unit_price ?? 0),
    line_total: Number(item.line_total ?? 0),
    gross_amount: discount.gross,
    discount_label: discount.label,
  };
}

export function buildPrintLineRows(
  items: DocumentDetailItem[],
  mode: PrintNameMode,
  hideZeroServiceLines: boolean,
): PrintLineRow[] {
  const printable = items.filter((item) => item.is_bundle_component !== true);
  const visible = hideZeroServiceLines
    ? printable.filter((item) => !isZeroServiceLine(item))
    : printable;

  if (mode === "sku") {
    return visible.map((item) =>
      rowFromItem(
        item,
        displayDocumentItemDescription(item.description, item.product_name),
      ),
    );
  }

  const groups = new Map<
    string,
    PrintLineRow & { count: number; discountAmount: number; discountText: string }
  >();
  for (const item of visible) {
    const label = shortLabel(item);
    const unit = netUnitPrice(item);
    const uom = item.uom_used?.trim() || "—";
    const discountText = String(item.discount_text ?? "").trim();
    const key = `${label}|${uom}|${unit.toFixed(2)}`;
    const existing = groups.get(key);
    const gross = roundMoney(Number(item.qty ?? 0) * Number(item.unit_price ?? 0));
    if (existing) {
      existing.qty = roundMoney(existing.qty + Number(item.qty ?? 0));
      existing.line_total = roundMoney(existing.line_total + Number(item.line_total ?? 0));
      existing.gross_amount = roundMoney(existing.gross_amount + gross);
      existing.discountAmount = roundMoney(
        existing.discountAmount + Number(item.discount_amount ?? 0),
      );
      existing.count += 1;
      existing.sku = "รวม";
      continue;
    }
    groups.set(key, {
      ...rowFromItem(item, label),
      count: 1,
      discountAmount: Number(item.discount_amount ?? 0),
      discountText,
    });
  }

  return [...groups.values()].map((row) => {
    const discount = lineDiscountPresentation({
      qty: row.qty,
      unit_price: row.qty > 0 ? row.gross_amount / row.qty : row.unit_price,
      discount_text: row.discountText,
      discount_amount: row.discountAmount,
    });
    return {
      key: row.key,
      sku: row.sku,
      description: withDiscountNote(shortLabelFromGrouped(row.description), discount.note),
      qty: row.qty,
      uom_used: row.uom_used,
      unit_price: row.qty > 0 ? roundMoney(row.line_total / row.qty) : roundMoney(row.unit_price),
      line_total: row.line_total,
      gross_amount: row.gross_amount,
      discount_label: discount.label,
    };
  });
}

function shortLabelFromGrouped(description: string): string {
  return description.replace(/\s*\([^)]*ส่วนลด[^)]*\)\s*$/u, "").trim();
}
