/**
 * Map unified WHT report rows → Excel export shape (ภ.ง.ด.3 / ภ.ง.ด.53).
 */

import type { TaxEntityType, UnifiedWhtRow, WHTReportRow } from "@/types/tax";

export function normalizeTaxId(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.slice(0, 13);
}

export function normalizeBranchCode(value: string | null | undefined): string {
  const digits = String(value ?? "00000").replace(/\D/g, "") || "00000";
  return digits.slice(0, 5).padStart(5, "0");
}

export function formatWhtPaymentDate(value: string): string {
  if (!value) return "";
  const d = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return value.slice(0, 10);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function mapWhtReportRowToUnified(row: WHTReportRow): UnifiedWhtRow {
  const contact = row.contacts;
  return {
    payment_date: row.expense_date ?? "",
    document_no: row.document_no ?? "",
    source: row.source,
    company_name: contact?.company_name?.trim() ?? "",
    tax_id: normalizeTaxId(contact?.tax_id ?? null),
    tax_branch_code: normalizeBranchCode(contact?.tax_branch_code ?? null),
    tax_address: contact?.tax_address?.trim() ?? "",
    wht_base_amount: row.wht_base_amount ?? 0,
    wht_rate: row.wht_rate ?? 0,
    wht_amount: row.wht_amount ?? 0,
  };
}

export function mapWhtReportRowsForExport(
  rows: WHTReportRow[],
  entityType: TaxEntityType,
): UnifiedWhtRow[] {
  return (rows ?? [])
    .filter((row) => row?.contacts?.entity_type === entityType)
    .map(mapWhtReportRowToUnified)
    .sort((a, b) => {
      const dateCmp = (a.payment_date ?? "").localeCompare(b.payment_date ?? "");
      if (dateCmp !== 0) return dateCmp;
      return (a.document_no ?? "").localeCompare(b.document_no ?? "", "th");
    });
}
