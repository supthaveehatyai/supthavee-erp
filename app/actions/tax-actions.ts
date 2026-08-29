"use server";

/**
 * Phase 8.5 — Tax & WHT Management Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import { loadMonthlyWhtReportRows } from "@/lib/tax/monthly-wht-report-data";
import type {
  GetMonthlyWHTReportResult,
  MonthlyWHTReportData,
  UpdateVendorTaxInfoResult,
  VendorTaxInfoInput,
  WHTReportRow,
} from "@/types/tax";

function isPaidWhtRow(row: WHTReportRow): boolean {
  if (row.source === "EXP") {
    return (row.status ?? "").trim().toUpperCase() === "PAID";
  }

  const paymentStatus = (row.payment_status ?? "").trim().toUpperCase();
  const docStatus = (row.status ?? "").trim().toUpperCase();
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

function buildSummary(rows: WHTReportRow[]): MonthlyWHTReportData["summary"] {
  const paidRows = rows.filter(isPaidWhtRow);
  const issuedRows = rows.filter((row) => !isPaidWhtRow(row));

  return {
    totalWhtBase: rows.reduce(
      (sum, item) => sum + (item.wht_base_amount ?? 0),
      0,
    ),
    totalWhtAmount: rows.reduce((sum, item) => sum + (item.wht_amount ?? 0), 0),
    paidWhtAmount: paidRows.reduce(
      (sum, item) => sum + (item.wht_amount ?? 0),
      0,
    ),
    issuedWhtAmount: issuedRows.reduce(
      (sum, item) => sum + (item.wht_amount ?? 0),
      0,
    ),
    paidCount: paidRows.length,
    issuedCount: issuedRows.length,
  };
}

function emptyMonthlyReport(): MonthlyWHTReportData {
  return {
    raw: [],
    pnd3: [],
    pnd53: [],
    pendingValidation: [],
    summary: buildSummary([]),
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
    const raw = await loadMonthlyWhtReportRows(year, month);
    const rows = Array.isArray(raw) ? raw : [];

    const pnd3 = rows.filter(
      (item) => item.contacts?.entity_type === "INDIVIDUAL",
    );
    const pnd53 = rows.filter(
      (item) => item.contacts?.entity_type === "CORPORATE",
    );
    const pendingValidation = rows.filter(isPendingValidation);

    return {
      success: true,
      data: {
        raw: rows,
        pnd3,
        pnd53,
        pendingValidation,
        summary: buildSummary(rows),
      },
    };
  } catch (error: unknown) {
    console.error("Error fetching WHT report:", error);
    return { success: true, data: emptyMonthlyReport() };
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
