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

/** Normalize DB date/timestamp → YYYY-MM-DD (empty string if invalid). */
export function safeWhtDateString(value: unknown): string {
  if (value == null) return "";
  const raw = String(value).trim();
  if (!raw) return "";

  const iso = raw.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const parsed = new Date(`${iso}T00:00:00`);
    if (!Number.isNaN(parsed.getTime())) return iso;
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";

  const yyyy = parsed.getFullYear();
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const dd = String(parsed.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function safeString(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

function safeNullableString(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function safeContactId(value: unknown): string | null {
  if (value == null) return null;
  const id = String(value).trim();
  return id || null;
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

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

function mapContact(raw: unknown): WHTContactTax | null {
  const row = unwrapJoin(
    raw as WHTContactTax | WHTContactTax[] | null | undefined,
  );
  if (!row || typeof row !== "object") return null;

  const c = row as Record<string, unknown>;
  const id = safeString(c.id);
  if (!id) return null;

  return {
    id,
    company_name: safeString(c.company_name),
    tax_id: safeNullableString(c.tax_id),
    tax_branch_code: safeNullableString(c.tax_branch_code),
    entity_type: safeNullableString(c.entity_type),
    tax_address: safeNullableString(c.tax_address),
    is_tax_validated:
      typeof c.is_tax_validated === "boolean" ? c.is_tax_validated : null,
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
    const leftDate = a.expense_date || "";
    const rightDate = b.expense_date || "";
    const dateCmp = rightDate.localeCompare(leftDate);
    if (dateCmp !== 0) return dateCmp;
    return (b.document_no || "").localeCompare(a.document_no || "", "th");
  });
}

function mapExpenseRow(row: Record<string, unknown>): WHTReportRow | null {
  try {
    const id = safeString(row.id);
    if (!id) return null;

    const expenseDate = safeWhtDateString(row.expense_date);
    const whtAmount = toMoney(row.wht_amount as number | string | null);
    if (whtAmount <= 0) return null;

    return {
      id,
      source: "EXP",
      document_no: safeString(row.document_no),
      expense_date: expenseDate,
      contact_id: safeContactId(row.vendor_id),
      wht_type: safeNullableString(row.wht_type),
      wht_base_amount:
        toMoney(row.wht_base_amount as number | string | null) ||
        toMoney(row.net_amount as number | string | null),
      wht_rate: toMoney(row.wht_rate as number | string | null),
      wht_amount: whtAmount,
      wht_doc_no: safeNullableString(row.wht_doc_no),
      status: safeString(row.status),
      contacts: mapContact(row.contacts),
    };
  } catch (error) {
    console.error("[loadMonthlyWhtReportRows] mapExpenseRow failed:", error, row);
    return null;
  }
}

function mapTbRow(row: Record<string, unknown>): WHTReportRow | null {
  try {
    const id = safeString(row.id);
    if (!id) return null;

    const expenseDate = safeWhtDateString(row.doc_date);
    const whtAmount = toMoney(row.wht_amount as number | string | null);
    if (whtAmount <= 0) return null;

    const notes =
      typeof row.notes === "string" ? row.notes : safeNullableString(row.notes);

    return {
      id,
      source: "TB",
      document_no: safeString(row.doc_no),
      expense_date: expenseDate,
      contact_id: safeContactId(row.contact_id),
      wht_type: parseWhtTypeFromTbNotes(notes),
      wht_base_amount: toMoney(
        (row.net_before_vat ?? row.sub_total) as number | string | null,
      ),
      wht_rate: toMoney(row.wht_rate as number | string | null),
      wht_amount: whtAmount,
      wht_doc_no: null,
      status: safeString(row.status),
      payment_status: safeNullableString(row.payment_status),
      contacts: mapContact(row.contacts),
    };
  } catch (error) {
    console.error("[loadMonthlyWhtReportRows] mapTbRow failed:", error, row);
    return null;
  }
}

/** Load merged EXP + TB rows for a calendar month. Never throws — returns [] on failure. */
export async function loadMonthlyWhtReportRows(
  year: number,
  month: number,
): Promise<WHTReportRow[]> {
  try {
    const bounds = monthBounds(year, month);
    if (!bounds) {
      console.error("[loadMonthlyWhtReportRows] invalid period:", { year, month });
      return [];
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
          contacts!documents_contact_id_fkey (
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
      console.error(
        "[loadMonthlyWhtReportRows] expenses query failed:",
        expensesResult.error,
      );
    }
    if (tbResult.error) {
      console.error(
        "[loadMonthlyWhtReportRows] documents (TB) query failed:",
        tbResult.error,
      );
    }

    const expenseRows = (expensesResult.data ?? [])
      .map((row) => mapExpenseRow(row as Record<string, unknown>))
      .filter((row): row is WHTReportRow => row != null);

    const tbRows = (tbResult.data ?? [])
      .map((row) => mapTbRow(row as Record<string, unknown>))
      .filter((row): row is WHTReportRow => row != null);

    return sortWhtRowsDesc([...expenseRows, ...tbRows]);
  } catch (error) {
    console.error("[loadMonthlyWhtReportRows] unexpected error:", error);
    return [];
  }
}
