"use server";

import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { canAccessReportCenter } from "@/lib/auth/module-access";
import { parseOutputTaxSubFilter } from "@/lib/tax/output-tax-series";
import { createClient } from "@/lib/supabase/server-admin";
import type { BatchSalesPdfDocument, BatchSalesPdfItem } from "@/types/batch-sales-pdf";

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : 0;
}

function parseItems(value: unknown): BatchSalesPdfItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = item as Record<string, unknown>;
    const qty = num(row.qty);
    return {
      id: String(row.id ?? ""),
      description: String(row.description ?? "").trim() || "สินค้า",
      qty: qty > 0 ? qty : 1,
      uom_used: String(row.uom_used ?? "").trim() || "ตัว",
      unit_price: num(row.unit_price),
      line_total: num(row.line_total),
    };
  });
}

function parseDocuments(data: unknown): BatchSalesPdfDocument[] {
  let source = data;
  if (typeof data === "string") {
    try {
      source = JSON.parse(data) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(source)) return [];
  return source.map((item) => {
    const row = item as Record<string, unknown>;
    return {
      id: String(row.id ?? ""),
      doc_no: String(row.doc_no ?? "").trim(),
      doc_type: String(row.doc_type ?? "").trim(),
      status: String(row.status ?? "").trim(),
      is_voided: row.is_voided === true,
      doc_date: String(row.doc_date ?? "").slice(0, 10),
      sales_channel: String(row.sales_channel ?? "STORE").trim() || "STORE",
      customer_name: String(row.customer_name ?? "").trim() || "ลูกค้าทั่วไป",
      customer_tax_id: String(row.customer_tax_id ?? "").trim(),
      customer_branch: String(row.customer_branch ?? "").trim(),
      customer_address: String(row.customer_address ?? "").trim(),
      net_before_vat: num(row.net_before_vat),
      vat_amount: num(row.vat_amount),
      grand_total: num(row.grand_total),
      vat_type: String(row.vat_type ?? "INCLUSIVE").trim() || "INCLUSIVE",
      items: parseItems(row.items),
    };
  });
}

async function assertReportCenter(): Promise<{ ok: true } | { ok: false; error: string }> {
  const actor = await getCurrentAuthUser();
  if (!actor) return { ok: false, error: "กรุณาเข้าสู่ระบบก่อนส่งออกเอกสาร" };
  if (!canAccessReportCenter(actor.accessibleModules, actor.roleCode)) {
    return { ok: false, error: "ไม่มีสิทธิ์ใช้งานศูนย์รายงาน" };
  }
  return { ok: true };
}

export async function getBatchSalesDocumentsForPdf(
  year: number,
  month: number,
  subFilter: string,
): Promise<
  | { ok: true; documents: BatchSalesPdfDocument[] }
  | { ok: false; error: string }
> {
  const access = await assertReportCenter();
  if (!access.ok) return access;
  if (
    !Number.isInteger(year) ||
    year < 2000 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12
  ) {
    return { ok: false, error: "เดือนหรือปีไม่ถูกต้อง" };
  }

  const filter = parseOutputTaxSubFilter(subFilter);
  const supabase = createClient();
  const rpc = supabase as unknown as {
    rpc: (
      fn: string,
      args: { p_year: number; p_month: number; p_sub_filter: string },
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
  };
  const { data, error } = await rpc.rpc("get_batch_sales_documents_for_pdf", {
    p_year: year,
    p_month: month,
    p_sub_filter: filter,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, documents: parseDocuments(data) };
}
