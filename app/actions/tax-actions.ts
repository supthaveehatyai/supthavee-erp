"use server";

/**
 * Phase 8.5 — Tax & WHT Management Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import type {
  GetMonthlyWHTReportResult,
  MonthlyWHTReportData,
  UpdateVendorTaxInfoResult,
  VendorTaxInfoInput,
  WHTContactTax,
  WHTReportRow,
} from "@/types/tax";

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function monthBounds(
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

function isPaidWhtRow(row: WHTReportRow): boolean {
  if (row.source === "EXP") {
    return row.status.trim().toUpperCase() === "PAID";
  }

  const paymentStatus = (row.payment_status ?? "").trim().toUpperCase();
  const docStatus = row.status.trim().toUpperCase();
  return (
    paymentStatus === "PAID" ||
    docStatus === "PAID" ||
    docStatus === "COMPLETED"
  );
}

function isPendingValidation(item: WHTReportRow): boolean {
  const contact = item.contacts;
  if (!contact || !item.contact_id) return true;
  if (contact.entity_type == null || String(contact.entity_type).trim() === "") {
    return true;
  }
  if (contact.is_tax_validated !== true) return true;
  return false;
}

function sortWhtRowsDesc(rows: WHTReportRow[]): WHTReportRow[] {
  return [...rows].sort((a, b) => {
    const dateCmp = b.expense_date.localeCompare(a.expense_date);
    if (dateCmp !== 0) return dateCmp;
    return b.document_no.localeCompare(a.document_no, "th");
  });
}

function buildSummary(rows: WHTReportRow[]): MonthlyWHTReportData["summary"] {
  const paidRows = rows.filter(isPaidWhtRow);
  const issuedRows = rows.filter((row) => !isPaidWhtRow(row));

  return {
    totalWhtBase: rows.reduce((sum, item) => sum + item.wht_base_amount, 0),
    totalWhtAmount: rows.reduce((sum, item) => sum + item.wht_amount, 0),
    paidWhtAmount: paidRows.reduce((sum, item) => sum + item.wht_amount, 0),
    issuedWhtAmount: issuedRows.reduce((sum, item) => sum + item.wht_amount, 0),
    paidCount: paidRows.length,
    issuedCount: issuedRows.length,
  };
}

/**
 * Monthly WHT Report — expenses + TB documents with wht_amount > 0
 * for the given calendar month, merged and sorted newest-first.
 */
export async function getMonthlyWHTReport(
  year: number,
  month: number,
): Promise<GetMonthlyWHTReportResult> {
  try {
    const bounds = monthBounds(year, month);
    if (!bounds) {
      return {
        success: false,
        error: "ปี/เดือนไม่ถูกต้อง (month ต้องเป็น 1–12)",
      };
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

    const expenseRows: WHTReportRow[] = (expensesResult.data ?? []).map(
      (row) => {
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
      },
    );

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

    const raw = sortWhtRowsDesc([...expenseRows, ...tbRows]);

    const pnd3 = raw.filter(
      (item) => item.contacts?.entity_type === "INDIVIDUAL",
    );
    const pnd53 = raw.filter(
      (item) => item.contacts?.entity_type === "CORPORATE",
    );
    const pendingValidation = raw.filter(isPendingValidation);

    return {
      success: true,
      data: {
        raw,
        pnd3,
        pnd53,
        pendingValidation,
        summary: buildSummary(raw),
      },
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error fetching WHT report:", error);
    return { success: false, error: message };
  }
}

/**
 * Update vendor tax master data and mark as validated.
 * Service Role only — then revalidate WHT Report.
 */
export async function updateVendorTaxInfo(
  contactId: string,
  data: VendorTaxInfoInput,
): Promise<UpdateVendorTaxInfoResult> {
  try {
    const id = contactId?.trim();
    if (!id) {
      return { success: false, error: "ไม่พบ contact_id ของผู้จำหน่าย" };
    }

    const entityType = data.entity_type;
    if (entityType !== "INDIVIDUAL" && entityType !== "CORPORATE") {
      return {
        success: false,
        error: "ประเภทต้องเป็น INDIVIDUAL หรือ CORPORATE",
      };
    }

    const taxId = data.tax_id?.trim() ?? "";
    if (!/^\d{13}$/.test(taxId)) {
      return {
        success: false,
        error: "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก",
      };
    }

    let branch = (data.tax_branch_code ?? "00000").trim();
    if (!branch) branch = "00000";
    if (!/^\d{1,5}$/.test(branch)) {
      return {
        success: false,
        error: "รหัสสาขาต้องเป็นตัวเลขไม่เกิน 5 หลัก (เช่น 00000)",
      };
    }
    branch = branch.padStart(5, "0");

    const taxAddress = data.tax_address?.trim() || null;

    const supabase = createClient();
    const { error } = await supabase
      .from("contacts")
      .update({
        entity_type: entityType,
        tax_id: taxId,
        tax_branch_code: branch,
        tax_address: taxAddress,
        is_tax_validated: true,
      })
      .eq("id", id);

    if (error) {
      return { success: false, error: error.message };
    }

    revalidatePath("/tax/wht-report");
    revalidatePath("/tax/wht-report", "layout");

    return { success: true, error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Error updating vendor tax info:", error);
    return { success: false, error: message };
  }
}
