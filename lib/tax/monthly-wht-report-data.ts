/**
 * Shared monthly WHT report data loader (EXP + TB).
 * Used by Server Actions and API export — not a `"use server"` module.
 */

import { createClient } from "@/lib/supabase/server-admin";
import type { WHTContactTax, WHTReportRow } from "@/types/tax";

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function monthBounds(
  year: number,
  month: number,
): { startDate: string; endDate: string } | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { startDate, endDate };
}

function mapContact(raw: unknown): WHTContactTax | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  return {
    id: String(c.id ?? ""),
    company_name: String(c.company_name ?? ""),
    tax_id: (c.tax_id as string | null) ?? null,
    tax_branch_code: (c.tax_branch_code as string | null) ?? null,
    entity_type: (c.entity_type as string | null) ?? null,
    tax_address: (c.tax_address as string | null) ?? null,
    is_tax_validated: (c.is_tax_validated as boolean | null) ?? null,
  };
}

function parseWhtTypeFromTbNotes(notes: string | null | undefined): string | null {
  const text = String(notes ?? "").trim();
  if (!text) return null;
  const match = /หัก ณ ที่จ่าย\s+(.+?)\s+[\d.]+%/.exec(text);
  return match?.[1]?.trim() || null;
}

export function sortWhtRowsDesc(rows: WHTReportRow[]): WHTReportRow[] {
  return [...rows].sort((a, b) => {
    const dateCmp = b.expense_date.localeCompare(a.expense_date);
    if (dateCmp !== 0) return dateCmp;
    return b.document_no.localeCompare(a.document_no, "th");
  });
}

/** Load merged EXP + TB rows for a calendar month. */
export async function loadMonthlyWhtReportRows(
  year: number,
  month: number,
): Promise<WHTReportRow[]> {
  const bounds = monthBounds(year, month);
  if (!bounds) {
    throw new Error("ปี/เดือนไม่ถูกต้อง (month ต้องเป็น 1–12)");
  }

  const supabase = createClient();

  const [expensesResult, tbResult] = await Promise.all([
    supabase
      .from("expenses")
      .select(
        `
        id,
        document_no,
        expense_date,
        vendor_id,
        wht_type,
        wht_base_amount,
        net_amount,
        wht_rate,
        wht_amount,
        wht_doc_no,
        status,
        contacts!expenses_vendor_id_fkey (
          id,
          company_name,
          tax_id,
          tax_branch_code,
          entity_type,
          tax_address,
          is_tax_validated
        )
      `,
      )
      .gt("wht_amount", 0)
      .in("status", ["ISSUED", "PAID"])
      .gte("expense_date", bounds.startDate)
      .lte("expense_date", bounds.endDate),
    supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
        doc_date,
        contact_id,
        sub_total,
        net_before_vat,
        wht_rate,
        wht_amount,
        status,
        payment_status,
        notes,
        contacts:contact_id (
          id,
          company_name,
          tax_id,
          tax_branch_code,
          entity_type,
          tax_address,
          is_tax_validated
        )
      `,
      )
      .eq("doc_type", "TB")
      .gt("wht_amount", 0)
      .gte("doc_date", bounds.startDate)
      .lte("doc_date", bounds.endDate)
      .in("status", ["ISSUED", "COMPLETED", "PAID"])
      .or("is_voided.is.null,is_voided.eq.false"),
  ]);

  if (expensesResult.error) {
    throw new Error(expensesResult.error.message);
  }
  if (tbResult.error) {
    throw new Error(tbResult.error.message);
  }

  const expenseRows: WHTReportRow[] = (expensesResult.data ?? []).map((row) => {
    const contactId =
      row.vendor_id == null || String(row.vendor_id).trim() === ""
        ? null
        : String(row.vendor_id);
    return {
      id: String(row.id),
      source: "EXP",
      document_no: String(row.document_no ?? ""),
      expense_date: String(row.expense_date ?? "").slice(0, 10),
      contact_id: contactId,
      wht_type: row.wht_type ?? null,
      wht_base_amount:
        toMoney(row.wht_base_amount) || toMoney(row.net_amount),
      wht_rate: toMoney(row.wht_rate),
      wht_amount: toMoney(row.wht_amount),
      wht_doc_no: row.wht_doc_no ?? null,
      status: String(row.status ?? ""),
      contacts: mapContact(row.contacts),
    };
  });

  const tbRows: WHTReportRow[] = (tbResult.data ?? []).map((row) => {
    const contactId =
      row.contact_id == null || String(row.contact_id).trim() === ""
        ? null
        : String(row.contact_id);
    const whtBase = toMoney(row.net_before_vat ?? row.sub_total);
    return {
      id: String(row.id),
      source: "TB",
      document_no: String(row.doc_no ?? ""),
      expense_date: String(row.doc_date ?? "").slice(0, 10),
      contact_id: contactId,
      wht_type: parseWhtTypeFromTbNotes(row.notes),
      wht_base_amount: whtBase,
      wht_rate: toMoney(row.wht_rate),
      wht_amount: toMoney(row.wht_amount),
      wht_doc_no: null,
      status: String(row.status ?? ""),
      payment_status: row.payment_status ?? null,
      contacts: mapContact(row.contacts),
    };
  });

  return sortWhtRowsDesc([...expenseRows, ...tbRows]);
}
