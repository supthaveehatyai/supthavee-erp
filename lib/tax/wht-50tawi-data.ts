/**
 * Server-side data loader for ภ.ง.ด.50 ทวิ (EXP + TB).
 */

import { getSystemSettings } from "@/lib/actions/settings";
import { createClient } from "@/lib/supabase/server-admin";
import type {
  LoadWht50TawiResult,
  Wht50TawiPayee,
  Wht50TawiPayer,
  Wht50TawiPrintPayload,
} from "@/types/tax-wht-print";
import type { WHTReportSource } from "@/types/tax";

type VendorJoin = {
  company_name?: string | null;
  tax_id?: string | null;
  tax_branch_code?: string | null;
  tax_address?: string | null;
  address?: string | null;
  entity_type?: string | null;
};

function unwrapJoin<T extends object>(
  value: T | T[] | null | undefined,
): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseWhtTypeFromTbNotes(notes: string | null | undefined): string | null {
  const text = String(notes ?? "").trim();
  if (!text) return null;
  const match = /หัก ณ ที่จ่าย\s+(.+?)\s+[\d.]+%/.exec(text);
  return match?.[1]?.trim() || null;
}

function mapPayee(vendor: VendorJoin | null): Wht50TawiPayee {
  return {
    name: vendor?.company_name?.trim() || "—",
    taxId: vendor?.tax_id?.trim() || null,
    taxBranchCode: vendor?.tax_branch_code?.trim() || null,
    address: vendor?.tax_address?.trim() || vendor?.address?.trim() || "—",
    entityType: vendor?.entity_type ?? null,
  };
}

export async function loadWht50TawiPayer(): Promise<Wht50TawiPayer> {
  const settingsResult = await getSystemSettings();
  if (settingsResult.success && settingsResult.data) {
    const s = settingsResult.data;
    const branch =
      s.branch_code && s.branch_code !== "00000"
        ? ` (สาขา ${s.branch_code}${s.branch_name ? ` ${s.branch_name}` : ""})`
        : "";
    return {
      name: s.company_name?.trim() || "—",
      taxId: s.tax_id?.trim() || "",
      address: `${s.address?.trim() || "—"}${branch}`,
    };
  }

  return {
    name: "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด",
    taxId: "0905564000520",
    address:
      "234-235 ถนนเพชรเกษม ตำบลหาดใหญ่ อำเภอหาดใหญ่ จังหวัดสงขลา",
  };
}

async function loadExpenseWht50Tawi(
  expenseId: string,
): Promise<LoadWht50TawiResult> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select(
      `
      id,
      document_no,
      expense_date,
      wht_base_amount,
      wht_amount,
      wht_doc_no,
      wht_type,
      net_amount,
      contacts!expenses_vendor_id_fkey (
        company_name,
        tax_id,
        tax_branch_code,
        tax_address,
        address,
        entity_type
      )
    `,
    )
    .eq("id", expenseId)
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "ไม่พบเอกสารค่าใช้จ่าย" };

  const whtAmount = toMoney(data.wht_amount);
  if (whtAmount <= 0) {
    return { success: false, error: "เอกสารนี้ไม่มียอดหัก ณ ที่จ่าย" };
  }

  const vendor = unwrapJoin(data.contacts as VendorJoin | VendorJoin[] | null);
  const whtBase =
    data.wht_base_amount != null && Number(data.wht_base_amount) > 0
      ? toMoney(data.wht_base_amount)
      : toMoney(data.net_amount);
  const payDate = String(data.expense_date ?? "").slice(0, 10);
  const payer = await loadWht50TawiPayer();

  const payload: Wht50TawiPrintPayload = {
    source: "EXP",
    documentId: String(data.id),
    documentNo: String(data.document_no ?? ""),
    certNo:
      data.wht_doc_no?.trim() ||
      data.document_no?.trim() ||
      expenseId.slice(0, 8),
    payDate,
    whtBase,
    whtAmount,
    whtType: data.wht_type ?? null,
    payee: mapPayee(vendor),
  };

  return { success: true, payer, data: payload };
}

async function loadTbWht50Tawi(documentId: string): Promise<LoadWht50TawiResult> {
  const supabase = createClient();
  const uuidPattern =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const selectSql = `
    id,
    doc_no,
    doc_date,
    doc_type,
    sub_total,
    net_before_vat,
    wht_amount,
    notes,
    contacts:contact_id (
      company_name,
      tax_id,
      tax_branch_code,
      tax_address,
      address,
      entity_type
    )
  `;

  let { data, error } = await supabase
    .from("documents")
    .select(selectSql)
    .eq("doc_type", "TB")
    .eq("doc_no", documentId.trim())
    .maybeSingle();

  if (!data && !error && uuidPattern.test(documentId.trim())) {
    const byId = await supabase
      .from("documents")
      .select(selectSql)
      .eq("doc_type", "TB")
      .eq("id", documentId.trim())
      .maybeSingle();
    data = byId.data;
    error = byId.error;
  }

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "ไม่พบเอกสารสรุปวางบิลช่าง (TB)" };

  const whtAmount = toMoney(data.wht_amount);
  if (whtAmount <= 0) {
    return { success: false, error: "เอกสารนี้ไม่มียอดหัก ณ ที่จ่าย" };
  }

  const vendor = unwrapJoin(data.contacts as VendorJoin | VendorJoin[] | null);
  const whtBase = toMoney(data.net_before_vat ?? data.sub_total);
  const payDate = String(data.doc_date ?? "").slice(0, 10);
  const payer = await loadWht50TawiPayer();

  const payload: Wht50TawiPrintPayload = {
    source: "TB",
    documentId: String(data.id),
    documentNo: String(data.doc_no ?? ""),
    certNo: String(data.doc_no ?? documentId.slice(0, 8)),
    payDate,
    whtBase,
    whtAmount,
    whtType: parseWhtTypeFromTbNotes(data.notes),
    payee: mapPayee(vendor),
  };

  return { success: true, payer, data: payload };
}

export async function loadWht50TawiPrintData(
  source: WHTReportSource,
  documentId: string,
): Promise<LoadWht50TawiResult> {
  const id = documentId?.trim() ?? "";
  if (!id) return { success: false, error: "ไม่พบรหัสเอกสาร" };

  if (source === "EXP") return loadExpenseWht50Tawi(id);
  if (source === "TB") return loadTbWht50Tawi(id);
  return { success: false, error: "ประเภทเอกสารไม่รองรับ" };
}
