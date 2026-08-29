/**
 * Map unified WHT report rows → Excel export shape (ภ.ง.ด.3 / ภ.ง.ด.53).
 */

import { safeWhtDateString } from "@/lib/tax/monthly-wht-report-data";
import type { TaxEntityType, UnifiedWhtRow, WHTReportRow } from "@/types/tax";

function toWhtNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function safeTrim(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  return String(value).trim() || fallback;
}

export function normalizeTaxId(value: string | null | undefined): string {
  const raw = safeTrim(value);
  if (!raw || raw === "-") return "";
  const digits = raw.replace(/\D/g, "");
  return digits.slice(0, 13);
}

export function normalizeBranchCode(value: string | null | undefined): string {
  const raw = safeTrim(value, "00000") || "00000";
  const digits = raw.replace(/\D/g, "") || "00000";
  return digits.slice(0, 5).padStart(5, "0");
}

export function formatWhtPaymentDate(value: string | null | undefined): string {
  const normalized = safeWhtDateString(value);
  if (!normalized) return "";

  const d = new Date(`${normalized}T00:00:00`);
  if (Number.isNaN(d.getTime())) return normalized;

  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

export function mapWhtReportRowToUnified(row: WHTReportRow): UnifiedWhtRow {
  const contact = row?.contacts ?? null;
  const paymentDate = safeWhtDateString(row?.expense_date) || "";

  const taxIdRaw = contact?.tax_id ?? null;
  const taxId = taxIdRaw ? normalizeTaxId(taxIdRaw) : "";

  return {
    payment_date: paymentDate,
    document_no: safeTrim(row?.document_no),
    source: row?.source ?? "EXP",
    company_name: safeTrim(contact?.company_name),
    tax_id: taxId,
    tax_branch_code: normalizeBranchCode(contact?.tax_branch_code ?? null),
    tax_address: safeTrim(contact?.tax_address),
    wht_base_amount: toWhtNumber(row?.wht_base_amount),
    wht_rate: toWhtNumber(row?.wht_rate),
    wht_amount: toWhtNumber(row?.wht_amount),
  };
}

export function mapWhtReportRowsForExport(
  rows: WHTReportRow[],
  entityType: TaxEntityType,
): UnifiedWhtRow[] {
  return (rows ?? [])
    .filter((row) => row?.contacts?.entity_type === entityType)
    .map((row) => {
      try {
        return mapWhtReportRowToUnified(row);
      } catch (error) {
        console.error("[WHT_REPORT_ERROR] mapWhtReportRowToUnified failed:", error, row);
        return null;
      }
    })
    .filter((row): row is UnifiedWhtRow => row != null)
    .sort((a, b) => {
      const dateCmp = (a.payment_date ?? "").localeCompare(b.payment_date ?? "");
      if (dateCmp !== 0) return dateCmp;
      return (a.document_no ?? "").localeCompare(b.document_no ?? "", "th");
    });
}
