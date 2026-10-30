import type { SupabaseClient } from "@supabase/supabase-js";
import type { CashReceiptBill, CashReceiptLine, CashReceiptPack } from "@/types/cash-receipt";

const PURCHASE_TYPES = ["AP_INV", "AP_TAX"] as const;

export function splitCashReceiptBase(grandTotal: number): { goodsBase: number; vatPortion: number } {
  const grand = Math.round((grandTotal + Number.EPSILON) * 100) / 100;
  const goodsBase = Math.round(((grand * 100) / 107) * 100) / 100;
  const vatPortion = Math.round((grand - goodsBase) * 100) / 100;
  return { goodsBase, vatPortion };
}

export function isVendorTaxTier(value: string): value is "CORP_VAT" | "INDIVIDUAL_ID_1_2" | "INTERNAL_NO_ID_1_3" {
  return value === "CORP_VAT" || value === "INDIVIDUAL_ID_1_2" || value === "INTERNAL_NO_ID_1_3";
}

export function isAccountingTaxTier(value: string): value is "CORP_VAT" | "RECEIPT_1_2" | "INTERNAL_1_3" {
  return value === "CORP_VAT" || value === "RECEIPT_1_2" || value === "INTERNAL_1_3";
}

type LedgerRow = {
  id: string;
  doc_no: string | null;
  doc_date: string | null;
  grand_total: number | string | null;
  discount_amount: number | string | null;
  cash_receipt_no: string | null;
  accounting_tax_tier: string | null;
  tax_rate: number | string | null;
  status: string | null;
  contacts:
    | {
        company_name?: string | null;
        address?: string | null;
        tax_id?: string | null;
        vendor_tax_tier?: string | null;
      }
    | {
        company_name?: string | null;
        address?: string | null;
        tax_id?: string | null;
        vendor_tax_tier?: string | null;
      }[]
    | null;
};

function money(value: number | string | null | undefined): number {
  const amount = typeof value === "number" ? value : Number(value ?? 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function contactOf(row: LedgerRow) {
  const contact = Array.isArray(row.contacts) ? row.contacts[0] : row.contacts;
  return contact ?? null;
}

function qualifies(row: LedgerRow): boolean {
  const status = String(row.status ?? "").toUpperCase();
  if (status === "VOID" || status === "CANCELLED") return false;
  if (row.accounting_tax_tier === "RECEIPT_1_2") return true;
  const contact = contactOf(row);
  return money(row.tax_rate) === 0 && contact?.vendor_tax_tier === "INDIVIDUAL_ID_1_2";
}

export async function loadAccountingTaxTiers(
  supabase: SupabaseClient,
  documentIds: string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  const ids = Array.from(new Set(documentIds.filter(Boolean)));
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const { data, error } = await supabase
      .from("documents")
      .select("id, accounting_tax_tier")
      .in("id", chunk);
    if (error) return found;
    for (const row of data ?? []) {
      const tier = String((row as { accounting_tax_tier?: string | null }).accounting_tax_tier ?? "").trim();
      if (tier) found.set(String((row as { id: string }).id), tier);
    }
  }
  return found;
}

export async function loadCashReceiptPack(
  supabase: SupabaseClient,
  fromDate: string,
  toDate: string,
): Promise<CashReceiptPack> {
  const { data, error } = await supabase
    .from("documents")
    .select(
      `
      id,
      doc_no,
      doc_date,
      grand_total,
      discount_amount,
      cash_receipt_no,
      accounting_tax_tier,
      tax_rate,
      status,
      contacts:contact_id (
        company_name,
        address,
        tax_id,
        vendor_tax_tier
      )
    `,
    )
    .in("doc_type", [...PURCHASE_TYPES])
    .gte("doc_date", fromDate)
    .lte("doc_date", toDate)
    .order("doc_date", { ascending: true })
    .order("doc_no", { ascending: true });

  if (error) return { fromDate, toDate, bills: [], error: error.message };

  const rows = ((data ?? []) as unknown as LedgerRow[]).filter(qualifies);
  const ids = rows.map((row) => row.id);
  const linesByDoc = new Map<string, CashReceiptLine[]>();
  for (let index = 0; index < ids.length; index += 200) {
    const chunk = ids.slice(index, index + 200);
    const { data: items, error: itemError } = await supabase
      .from("document_items")
      .select("document_id, description, qty, unit_price, line_total, discount_amount, sort_order")
      .in("document_id", chunk)
      .order("sort_order", { ascending: true });
    if (itemError) return { fromDate, toDate, bills: [], error: itemError.message };
    for (const item of items ?? []) {
      const documentId = String(item.document_id);
      const list = linesByDoc.get(documentId) ?? [];
      const description = String(item.description ?? "").trim() || "สินค้า";
      list.push({
        description,
        qty: Number(item.qty ?? 0),
        unitPrice: money(item.unit_price),
        amount: money(item.line_total),
      });
      linesByDoc.set(documentId, list);
    }
  }

  const bills: CashReceiptBill[] = rows.map((row) => {
    const contact = contactOf(row);
    const grandTotal = money(row.grand_total);
    const split = splitCashReceiptBase(grandTotal);
    const lines = linesByDoc.get(row.id) ?? [];
    return {
      id: row.id,
      docNo: String(row.doc_no ?? ""),
      docDate: String(row.doc_date ?? "").slice(0, 10),
      cashReceiptNo: row.cash_receipt_no?.trim() || null,
      vendorName: String(contact?.company_name ?? "").trim() || "ไม่ระบุชื่อ",
      vendorAddress: contact?.address?.trim() || null,
      vendorTaxId: contact?.tax_id?.trim() || null,
      grandTotal,
      discountAmount: money(row.discount_amount),
      goodsBase: split.goodsBase,
      vatPortion: split.vatPortion,
      lines:
        lines.length > 0
          ? lines
          : [
              {
                description: "ซื้อสินค้า",
                qty: 1,
                unitPrice: grandTotal,
                amount: grandTotal,
              },
            ],
    };
  });

  return { fromDate, toDate, bills, error: null };
}
