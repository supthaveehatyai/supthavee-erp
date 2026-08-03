"use server";

/**
 * Phase 8.5 — Tax & WHT Management Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";

export type TaxEntityType = "INDIVIDUAL" | "CORPORATE";

export type WHTContactTax = {
  id: string;
  company_name: string;
  tax_id: string | null;
  tax_branch_code: string | null;
  entity_type: string | null;
  tax_address: string | null;
  is_tax_validated: boolean | null;
};

export type WHTReportExpenseRow = {
  id: string;
  document_no: string;
  expense_date: string;
  /** expenses.vendor_id — for TaxValidationModal */
  contact_id: string | null;
  wht_type: string | null;
  wht_base_amount: number;
  wht_rate: number;
  wht_amount: number;
  wht_doc_no: string | null;
  status: string;
  contacts: WHTContactTax | null;
};

export type MonthlyWHTReportData = {
  raw: WHTReportExpenseRow[];
  /** ภ.ง.ด.3 — บุคคลธรรมดา */
  pnd3: WHTReportExpenseRow[];
  /** ภ.ง.ด.53 — นิติบุคคล */
  pnd53: WHTReportExpenseRow[];
  /**
   * รอตรวจสอบ: entity_type เป็น null หรือยังไม่ validate
   * (รวมกรณีไม่มีผู้จำหน่าย)
   */
  pendingValidation: WHTReportExpenseRow[];
  summary: {
    totalWhtBase: number;
    totalWhtAmount: number;
  };
};

export type GetMonthlyWHTReportResult =
  | { success: true; data: MonthlyWHTReportData }
  | { success: false; error: string };

export type VendorTaxInfoInput = {
  entity_type: TaxEntityType;
  tax_id: string;
  tax_branch_code?: string | null;
  tax_address?: string | null;
};

export type UpdateVendorTaxInfoResult = {
  success: boolean;
  error: string | null;
};

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

function isPendingValidation(item: WHTReportExpenseRow): boolean {
  const contact = item.contacts;
  if (!contact || !item.contact_id) return true;
  if (contact.entity_type == null || String(contact.entity_type).trim() === "") {
    return true;
  }
  if (contact.is_tax_validated !== true) return true;
  return false;
}

/**
 * Monthly WHT Report — ISSUED expenses with wht_amount > 0
 * for the given calendar month (expense_date), grouped for ภ.ง.ด.3 / 53.
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

    const { data, error } = await supabase
      .from("expenses")
      .select(
        `
        id,
        document_no,
        expense_date,
        vendor_id,
        wht_type,
        wht_base_amount,
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
      .eq("status", "ISSUED")
      .gt("wht_amount", 0)
      .gte("expense_date", bounds.startDate)
      .lte("expense_date", bounds.endDate)
      .order("expense_date", { ascending: true })
      .order("document_no", { ascending: true });

    if (error) throw new Error(error.message);

    const raw: WHTReportExpenseRow[] = (data ?? []).map((row) => {
      const contactId =
        row.vendor_id == null || String(row.vendor_id).trim() === ""
          ? null
          : String(row.vendor_id);
      return {
        id: String(row.id),
        document_no: String(row.document_no ?? ""),
        expense_date: String(row.expense_date ?? "").slice(0, 10),
        contact_id: contactId,
        wht_type: row.wht_type ?? null,
        wht_base_amount: toMoney(row.wht_base_amount),
        wht_rate: toMoney(row.wht_rate),
        wht_amount: toMoney(row.wht_amount),
        wht_doc_no: row.wht_doc_no ?? null,
        status: String(row.status ?? ""),
        contacts: mapContact(row.contacts),
      };
    });

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
        summary: {
          totalWhtBase: raw.reduce(
            (sum, item) => sum + item.wht_base_amount,
            0,
          ),
          totalWhtAmount: raw.reduce((sum, item) => sum + item.wht_amount, 0),
        },
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
