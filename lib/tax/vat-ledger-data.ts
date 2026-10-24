/**
 * Phase 19 — VAT Ledger data loader (Output / Input Tax).
 * Service Role only — never import from Client Components.
 */

import { createClient } from "@/lib/supabase/server-admin";
import {
  INPUT_TAX_DOC_TYPES,
  INPUT_TAX_STATUSES,
  OUTPUT_TAX_DOC_TYPES,
  OUTPUT_TAX_STATUSES,
  type VatLedgerReportType,
} from "@/lib/constants/document";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import type {
  VatLedgerCompanyHeader,
  VatLedgerLine,
  VatLedgerReport,
} from "@/types/tax-ledger";

type ContactJoin = {
  company_name?: string | null;
  tax_id?: string | null;
  branch_code?: string | null;
};

type DocumentTaxRow = {
  id: string;
  doc_no: string;
  doc_type: string;
  doc_date: string;
  status: string;
  net_before_vat: number | null;
  vat_amount: number | null;
  tax_amount: number | null;
  grand_total: number | null;
  sub_total: number | null;
  total_amount: number | null;
  ecommerce_buyer_name: string | null;
  reference_no?: string | null;
  tax_invoice_status?: string | null;
  tax_invoice_no?: string | null;
  tax_invoice_date?: string | null;
  tax_reported_base?: number | null;
  tax_reported_vat?: number | null;
  contacts: ContactJoin | ContactJoin[] | null;
};

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function unwrapContact(
  value: ContactJoin | ContactJoin[] | null,
): ContactJoin | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function trimText(value: unknown, fallback = ""): string {
  if (value == null) return fallback;
  const text = String(value).trim();
  return text || fallback;
}

export function parseVatLedgerPeriod(
  yearRaw: string | null,
  monthRaw: string | null,
): { year: number; month: number } | null {
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return null;
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return { year, month };
}

export function vatLedgerDateRange(
  year: number,
  month: number,
): { start: string; end: string } {
  const lastDay = new Date(year, month, 0).getDate();
  const mm = String(month).padStart(2, "0");
  return {
    start: `${year}-${mm}-01`,
    end: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

function formatBranchOffice(branchCode: string | null | undefined): string {
  const raw = trimText(branchCode);
  if (!raw || raw === "0" || raw === "00000") return "สำนักงานใหญ่";
  if (raw === "สำนักงานใหญ่") return raw;
  return raw;
}

function resolveGoodsAmount(row: DocumentTaxRow): number {
  if (row.net_before_vat != null && Number.isFinite(Number(row.net_before_vat))) {
    return roundMoney(Number(row.net_before_vat));
  }
  if (row.total_amount != null && Number.isFinite(Number(row.total_amount))) {
    return roundMoney(Number(row.total_amount));
  }
  return roundMoney(Number(row.sub_total ?? 0));
}

function resolveVatAmount(row: DocumentTaxRow): number {
  if (row.vat_amount != null && Number.isFinite(Number(row.vat_amount))) {
    return roundMoney(Number(row.vat_amount));
  }
  return roundMoney(Number(row.tax_amount ?? 0));
}

async function loadCompanyHeader(): Promise<VatLedgerCompanyHeader> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("system_settings")
    .select("company_name, tax_id, branch_name")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return {
    company_name: trimText(data?.company_name, "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด"),
    tax_id: trimText(data?.tax_id),
    branch_name: trimText(data?.branch_name, "สำนักงานใหญ่"),
  };
}

async function loadDocuments(input: {
  year: number;
  month: number;
  reportType: VatLedgerReportType;
}): Promise<DocumentTaxRow[]> {
  const supabase = createClient();
  const { start, end } = vatLedgerDateRange(input.year, input.month);
  const docTypes =
    input.reportType === "OUTPUT_TAX"
      ? [...OUTPUT_TAX_DOC_TYPES]
      : [...INPUT_TAX_DOC_TYPES];
  const statuses =
    input.reportType === "OUTPUT_TAX"
      ? [...OUTPUT_TAX_STATUSES]
      : [...INPUT_TAX_STATUSES];

  const pageSize = 1000;
  const rows: DocumentTaxRow[] = [];
  let from = 0;
  let legacyInput = input.reportType !== "INPUT_TAX";
  const baseSelect = `
        id,
        doc_no,
        doc_type,
        doc_date,
        status,
        net_before_vat,
        vat_amount,
        tax_amount,
        grand_total,
        sub_total,
        total_amount,
        ecommerce_buyer_name,
        contacts:contact_id (
          company_name,
          tax_id,
          branch_code
        )
      `;
  const inputSelect = `
        id,
        doc_no,
        reference_no,
        doc_type,
        doc_date,
        status,
        net_before_vat,
        vat_amount,
        tax_amount,
        grand_total,
        sub_total,
        total_amount,
        ecommerce_buyer_name,
        tax_invoice_status,
        tax_invoice_no,
        tax_invoice_date,
        tax_reported_base,
        tax_reported_vat,
        contacts:contact_id (
          company_name,
          tax_id,
          branch_code
        )
      `;

  type TaxQuery = {
    in: (column: string, values: readonly string[]) => TaxQuery;
    or: (filters: string) => TaxQuery;
    gte: (column: string, value: string) => TaxQuery;
    lte: (column: string, value: string) => TaxQuery;
    order: (column: string, options: { ascending: boolean }) => TaxQuery;
    range: (from: number, to: number) => Promise<{
      data: DocumentTaxRow[] | null;
      error: { message: string } | null;
    }>;
  };
  const documents = supabase.from("documents") as unknown as {
    select: (columns: string) => TaxQuery;
  };

  while (true) {
    let query: TaxQuery = documents
      .select(legacyInput ? baseSelect : inputSelect)
      .in("doc_type", docTypes)
      .in("status", statuses);

    if (!legacyInput) {
      query = query
        .or("tax_invoice_status.eq.TAX_READY,tax_invoice_status.is.null")
        .or(
          `and(tax_invoice_date.gte.${start},tax_invoice_date.lte.${end}),and(tax_invoice_date.is.null,doc_date.gte.${start},doc_date.lte.${end})`,
        );
    } else {
      query = query.gte("doc_date", start).lte("doc_date", end);
    }

    const { data, error } = await query
      .order("doc_date", { ascending: true })
      .order("doc_no", { ascending: true })
      .range(from, from + pageSize - 1);

    if (
      error &&
      !legacyInput &&
      /tax_invoice_|tax_reported_|schema cache|42703/i.test(error.message)
    ) {
      legacyInput = true;
      rows.length = 0;
      from = 0;
      continue;
    }

    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as DocumentTaxRow[];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function mapDocumentRow(
  row: DocumentTaxRow,
  index: number,
  reportType: VatLedgerReportType,
): VatLedgerLine {
  const contact = unwrapContact(row.contacts);
  const isVoid = String(row.status ?? "").toUpperCase() === "VOID";
  const buyerName = trimText(row.ecommerce_buyer_name);
  const partyName =
    reportType === "OUTPUT_TAX" && buyerName
      ? buyerName
      : trimText(contact?.company_name, "—");

  const inputTax = reportType === "INPUT_TAX";
  const goodsAmount = isVoid
    ? 0
    : inputTax
      ? roundMoney(
          row.tax_reported_base != null
            ? Number(row.tax_reported_base)
            : Number(row.sub_total ?? 0),
        )
      : resolveGoodsAmount(row);
  const vatAmount = isVoid
    ? 0
    : inputTax
      ? roundMoney(
          row.tax_reported_vat != null ? Number(row.tax_reported_vat) : Number(row.vat_amount ?? 0),
        )
      : resolveVatAmount(row);
  const grandTotal = isVoid
    ? 0
    : inputTax
      ? roundMoney(goodsAmount + vatAmount)
      : roundMoney(Number(row.grand_total ?? 0));
  const invoiceDate = inputTax ? row.tax_invoice_date || row.doc_date : row.doc_date;
  const invoiceNo = inputTax
    ? trimText(row.tax_invoice_no) || trimText(row.reference_no) || trimText(row.doc_no)
    : trimText(row.doc_no);

  return {
    seq: index + 1,
    invoice_date: formatThaiDate(invoiceDate, "short"),
    invoice_no: invoiceNo,
    party_name: partyName,
    tax_id: trimText(contact?.tax_id),
    branch_office: formatBranchOffice(contact?.branch_code),
    goods_amount: goodsAmount,
    vat_amount: vatAmount,
    grand_total: grandTotal,
    status: trimText(row.status).toUpperCase(),
    remark: isVoid ? "ยกเลิก" : "",
    is_void: isVoid,
  };
}

export async function loadVatLedgerReport(input: {
  year: number;
  month: number;
  reportType: VatLedgerReportType;
}): Promise<VatLedgerReport> {
  const [company, documents] = await Promise.all([
    loadCompanyHeader(),
    loadDocuments(input),
  ]);

  const rows = documents.map((row, index) =>
    mapDocumentRow(row, index, input.reportType),
  );

  const totals = rows.reduce(
    (acc, row) => ({
      goods_amount: roundMoney(acc.goods_amount + row.goods_amount),
      vat_amount: roundMoney(acc.vat_amount + row.vat_amount),
      grand_total: roundMoney(acc.grand_total + row.grand_total),
    }),
    { goods_amount: 0, vat_amount: 0, grand_total: 0 },
  );

  const periodAnchor = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
  const isOutput = input.reportType === "OUTPUT_TAX";

  return {
    reportType: input.reportType,
    year: input.year,
    month: input.month,
    periodLabel: formatThaiDate(periodAnchor, "monthYear"),
    title: isOutput ? "รายงานภาษีขาย" : "รายงานภาษีซื้อ",
    partyColumnLabel: isOutput ? "ชื่อผู้ซื้อ" : "ชื่อผู้ขาย",
    company,
    rows,
    totals,
  };
}
