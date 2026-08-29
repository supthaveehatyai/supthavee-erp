/**
 * Shared monthly WHT report data loader (EXP + TB).
 * Used by Server Actions and API export — not a `"use server"` module.
 *
 * Contact joins (schema):
 * - expenses.vendor_id  → contacts  (FK: expenses_vendor_id_fkey)
 * - documents.contact_id → contacts (FK: documents_contact_id_fkey) — TB only
 */

import { createClient } from "@/lib/supabase/server-admin";
import type { WHTContactTax, WHTReportRow } from "@/types/tax";

const EXPENSES_CONTACT_FK = "expenses_vendor_id_fkey";
const DOCUMENTS_CONTACT_FK = "documents_contact_id_fkey";

const DEFAULT_VENDOR_NAME = "ไม่ระบุชื่อคู่ค้า";
const DEFAULT_TAX_ID = "-";
const DEFAULT_BRANCH_CODE = "00000";

/** Extreme fallback — never null after resolveWhtContact(). */
const EMPTY_CONTACT: WHTContactTax = {
  id: "",
  company_name: DEFAULT_VENDOR_NAME,
  tax_id: DEFAULT_TAX_ID,
  tax_branch_code: DEFAULT_BRANCH_CODE,
  entity_type: null,
  tax_address: null,
  is_tax_validated: null,
};

/** Explicit numeric coercion for WHT tax fields. */
function toWhtNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function safeTrim(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value === "string") return value.trim() || fallback;
  return String(value).trim() || fallback;
}

/** Normalize DB date/timestamp → YYYY-MM-DD (empty string if invalid). */
export function safeWhtDateString(value: unknown): string {
  if (value == null) return "";
  const raw = safeTrim(value);
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

function safeNullableString(value: unknown): string | null {
  const text = safeTrim(value);
  return text || null;
}

function safeContactId(value: unknown): string | null {
  const id = safeTrim(value);
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

function asContactRecord(raw: unknown): Record<string, unknown> {
  const row = unwrapJoin(raw as Record<string, unknown> | Record<string, unknown>[] | null);
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    return {};
  }
  return row as Record<string, unknown>;
}

/**
 * Resolve joined contacts row → WHTContactTax with extreme fallbacks.
 * Never throws; never returns null.
 */
function resolveWhtContact(raw: unknown): WHTContactTax {
  try {
    const contact = asContactRecord(raw);

    const id = safeTrim(contact?.id ?? "");
    const companyName =
      safeTrim(contact?.company_name ?? contact?.name) || DEFAULT_VENDOR_NAME;
    const taxId = safeTrim(contact?.tax_id) || DEFAULT_TAX_ID;
    const branch =
      safeTrim(contact?.tax_branch_code ?? contact?.branch_code) ||
      DEFAULT_BRANCH_CODE;

    return {
      id,
      company_name: companyName,
      tax_id: taxId,
      tax_branch_code: branch,
      entity_type: safeNullableString(contact?.entity_type),
      tax_address: safeNullableString(contact?.tax_address ?? contact?.address),
      is_tax_validated:
        typeof contact?.is_tax_validated === "boolean"
          ? contact.is_tax_validated
          : null,
    };
  } catch (error) {
    console.error("[WHT_REPORT_ERROR] resolveWhtContact failed:", error, raw);
    return { ...EMPTY_CONTACT };
  }
}

function resolveExpenseWhtBase(row: Record<string, unknown>): number {
  const base = Number(
    row?.wht_base_amount ?? row?.net_amount ?? row?.sub_total ?? 0,
  );
  return Number.isFinite(base) ? base : 0;
}

function resolveTbWhtBase(row: Record<string, unknown>): number {
  const base = Number(
    row?.net_before_vat ?? row?.sub_total ?? row?.net_amount ?? 0,
  );
  return Number.isFinite(base) ? base : 0;
}

function parseWhtTypeFromTbNotes(notes: unknown): string | null {
  const text = safeTrim(notes);
  if (!text) return null;
  const match = /หัก ณ ที่จ่าย\s+(.+?)\s+[\d.]+%/.exec(text);
  return match?.[1]?.trim() || null;
}

export function sortWhtRowsDesc(rows: WHTReportRow[]): WHTReportRow[] {
  return [...rows].sort((a, b) => {
    const leftDate = a?.expense_date ?? "";
    const rightDate = b?.expense_date ?? "";
    const dateCmp = rightDate.localeCompare(leftDate);
    if (dateCmp !== 0) return dateCmp;
    return (b?.document_no ?? "").localeCompare(a?.document_no ?? "", "th");
  });
}

function mapExpenseRow(row: Record<string, unknown>): WHTReportRow | null {
  try {
    const id = safeTrim(row?.id);
    if (!id) return null;

    const expenseDate = safeWhtDateString(row?.expense_date);
    const whtAmount = Number(row?.wht_amount ?? 0);
    if (!Number.isFinite(whtAmount) || whtAmount <= 0) return null;

    const contact = resolveWhtContact(row?.contacts);
    const whtBaseAmount = resolveExpenseWhtBase(row);
    const whtRate = Number(row?.wht_rate ?? 0);

    return {
      id,
      source: "EXP",
      document_no: safeTrim(row?.document_no),
      expense_date: expenseDate || "",
      contact_id: safeContactId(row?.vendor_id),
      wht_type: safeNullableString(row?.wht_type),
      wht_base_amount: Number.isFinite(whtBaseAmount) ? whtBaseAmount : 0,
      wht_rate: Number.isFinite(whtRate) ? whtRate : 0,
      wht_amount: whtAmount,
      wht_doc_no: safeNullableString(row?.wht_doc_no),
      status: safeTrim(row?.status),
      contacts: contact,
    };
  } catch (error) {
    console.error("[WHT_REPORT_ERROR] mapExpenseRow failed:", error, row);
    return null;
  }
}

function mapTbRow(row: Record<string, unknown>): WHTReportRow | null {
  try {
    const id = safeTrim(row?.id);
    if (!id) return null;

    const expenseDate = safeWhtDateString(row?.doc_date);
    const whtAmount = Number(row?.wht_amount ?? 0);
    if (!Number.isFinite(whtAmount) || whtAmount <= 0) return null;

    const contact = resolveWhtContact(row?.contacts);
    const whtBaseAmount = resolveTbWhtBase(row);
    const whtRate = Number(row?.wht_rate ?? 0);
    const notes = safeTrim(row?.notes) || null;

    return {
      id,
      source: "TB",
      document_no: safeTrim(row?.doc_no),
      expense_date: expenseDate || "",
      contact_id: safeContactId(row?.contact_id),
      wht_type: parseWhtTypeFromTbNotes(notes),
      wht_base_amount: Number.isFinite(whtBaseAmount) ? whtBaseAmount : 0,
      wht_rate: Number.isFinite(whtRate) ? whtRate : 0,
      wht_amount: whtAmount,
      wht_doc_no: null,
      status: safeTrim(row?.status),
      payment_status: safeNullableString(row?.payment_status),
      contacts: contact,
    };
  } catch (error) {
    console.error("[WHT_REPORT_ERROR] mapTbRow failed:", error, row);
    return null;
  }
}

const CONTACT_SELECT_FIELDS = `
  id,
  company_name,
  tax_id,
  tax_branch_code,
  branch_code,
  entity_type,
  tax_address,
  address,
  is_tax_validated
`;

/** Load merged EXP + TB rows for a calendar month. Never throws — returns [] on failure. */
export async function loadMonthlyWhtReportRows(
  year: number,
  month: number,
): Promise<WHTReportRow[]> {
  try {
    const bounds = monthBounds(year, month);
    if (!bounds) {
      console.error("[WHT_REPORT_ERROR] invalid period:", { year, month });
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
          contacts!${EXPENSES_CONTACT_FK} (
            ${CONTACT_SELECT_FIELDS}
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
          contacts!${DOCUMENTS_CONTACT_FK} (
            ${CONTACT_SELECT_FIELDS}
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
        "[WHT_REPORT_ERROR] expenses query failed:",
        expensesResult.error,
      );
    }
    if (tbResult.error) {
      console.error(
        "[WHT_REPORT_ERROR] documents (TB) query failed:",
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
    console.error("[WHT_REPORT_ERROR]", error);
    return [];
  }
}
