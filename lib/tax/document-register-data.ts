/**
 * Report Center — Document Register data (INV_DO / EXP / PAY).
 * Service Role only — never import from Client Components.
 */

import { createClient } from "@/lib/supabase/server-admin";
import {
  DOCUMENT_REGISTER_STATUSES,
  EXPENSE_REGISTER_STATUSES,
  getDocumentStatusLabel,
  type DocumentRegisterReportType,
} from "@/lib/constants/document";
import { vatLedgerDateRange } from "@/lib/tax/vat-ledger-data";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import type {
  DocumentRegisterReport,
  ReportCenterPreviewRow,
} from "@/types/finance-report";

type ContactJoin = {
  company_name?: string | null;
};

type DocumentRegisterRow = {
  id: string;
  doc_no: string;
  doc_date: string;
  status: string;
  net_before_vat: number | null;
  vat_amount: number | null;
  tax_amount: number | null;
  grand_total: number | null;
  sub_total: number | null;
  total_amount: number | null;
  ecommerce_buyer_name: string | null;
  contacts: ContactJoin | ContactJoin[] | null;
};

type ExpenseRegisterRow = {
  id: string;
  document_no: string;
  expense_date: string;
  status: string;
  net_amount: number | null;
  vat_amount: number | null;
  grand_total: number | null;
  contacts: ContactJoin | ContactJoin[] | null;
};

const PAGE_SIZE = 1000;

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

function resolveNet(row: DocumentRegisterRow): number {
  if (row.net_before_vat != null && Number.isFinite(Number(row.net_before_vat))) {
    return roundMoney(Number(row.net_before_vat));
  }
  if (row.total_amount != null && Number.isFinite(Number(row.total_amount))) {
    return roundMoney(Number(row.total_amount));
  }
  return roundMoney(Number(row.sub_total ?? 0));
}

function resolveVat(row: DocumentRegisterRow): number {
  if (row.vat_amount != null && Number.isFinite(Number(row.vat_amount))) {
    return roundMoney(Number(row.vat_amount));
  }
  return roundMoney(Number(row.tax_amount ?? 0));
}

function sumTotals(rows: ReportCenterPreviewRow[]) {
  return rows.reduce(
    (acc, row) => ({
      net_before_vat: roundMoney(acc.net_before_vat + row.net_before_vat),
      vat_amount: roundMoney(acc.vat_amount + row.vat_amount),
      grand_total: roundMoney(acc.grand_total + row.grand_total),
    }),
    { net_before_vat: 0, vat_amount: 0, grand_total: 0 },
  );
}

function registerMeta(reportType: DocumentRegisterReportType): {
  title: string;
  partyColumnLabel: string;
} {
  if (reportType === "INV_DO") {
    return {
      title: "ทะเบียนใบส่งของ (INV_DO)",
      partyColumnLabel: "ชื่อลูกค้า",
    };
  }
  if (reportType === "EXP") {
    return {
      title: "ทะเบียนค่าใช้จ่าย (EXP)",
      partyColumnLabel: "ชื่อผู้จำหน่าย",
    };
  }
  return {
    title: "ทะเบียนใบสำคัญจ่าย (PAY)",
    partyColumnLabel: "ชื่อผู้จำหน่าย",
  };
}

async function loadCompanyName(): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("system_settings")
    .select("company_name")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return trimText(data?.company_name, "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด");
}

async function loadDocumentRegisterRows(
  year: number,
  month: number,
  docType: "INV_DO" | "PAY",
): Promise<DocumentRegisterRow[]> {
  const supabase = createClient();
  const { start, end } = vatLedgerDateRange(year, month);
  const rows: DocumentRegisterRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("documents")
      .select(
        `
        id,
        doc_no,
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
          company_name
        )
      `,
      )
      .eq("doc_type", docType)
      .in("status", [...DOCUMENT_REGISTER_STATUSES])
      .gte("doc_date", start)
      .lte("doc_date", end)
      .order("doc_date", { ascending: true })
      .order("doc_no", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as DocumentRegisterRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function loadExpenseRegisterRows(
  year: number,
  month: number,
): Promise<ExpenseRegisterRow[]> {
  const supabase = createClient();
  const { start, end } = vatLedgerDateRange(year, month);
  const rows: ExpenseRegisterRow[] = [];
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("expenses")
      .select(
        `
        id,
        document_no,
        expense_date,
        status,
        net_amount,
        vat_amount,
        grand_total,
        contacts:vendor_id (
          company_name
        )
      `,
      )
      .in("status", [...EXPENSE_REGISTER_STATUSES])
      .gte("expense_date", start)
      .lte("expense_date", end)
      .order("expense_date", { ascending: true })
      .order("document_no", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) {
      throw new Error(error.message);
    }

    const page = (data ?? []) as ExpenseRegisterRow[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

function mapDocumentRow(
  row: DocumentRegisterRow,
  index: number,
  reportType: "INV_DO" | "PAY",
): ReportCenterPreviewRow {
  const contact = unwrapContact(row.contacts);
  const status = trimText(row.status).toUpperCase();
  const isVoid = status === "VOID";
  const buyerName = trimText(row.ecommerce_buyer_name);
  const partyName =
    reportType === "INV_DO" && buyerName
      ? buyerName
      : trimText(contact?.company_name, "—");

  return {
    seq: index + 1,
    doc_date: formatThaiDate(row.doc_date, "short"),
    doc_no: trimText(row.doc_no),
    party_name: partyName,
    net_before_vat: resolveNet(row),
    vat_amount: resolveVat(row),
    grand_total: roundMoney(Number(row.grand_total ?? 0)),
    status,
    status_label: getDocumentStatusLabel(status),
    is_void: isVoid,
  };
}

function mapExpenseRow(
  row: ExpenseRegisterRow,
  index: number,
): ReportCenterPreviewRow {
  const contact = unwrapContact(row.contacts);
  const status = trimText(row.status).toUpperCase();

  return {
    seq: index + 1,
    doc_date: formatThaiDate(row.expense_date, "short"),
    doc_no: trimText(row.document_no),
    party_name: trimText(contact?.company_name, "—"),
    net_before_vat: roundMoney(Number(row.net_amount ?? 0)),
    vat_amount: roundMoney(Number(row.vat_amount ?? 0)),
    grand_total: roundMoney(Number(row.grand_total ?? 0)),
    status,
    status_label: getDocumentStatusLabel(status),
    is_void: status === "VOID",
  };
}

export async function loadDocumentRegisterReport(input: {
  year: number;
  month: number;
  reportType: DocumentRegisterReportType;
}): Promise<DocumentRegisterReport> {
  const meta = registerMeta(input.reportType);
  const periodAnchor = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
  const companyName = await loadCompanyName();

  let rows: ReportCenterPreviewRow[];
  if (input.reportType === "EXP") {
    const expenseRows = await loadExpenseRegisterRows(input.year, input.month);
    rows = expenseRows.map((row, index) => mapExpenseRow(row, index));
  } else {
    const docType = input.reportType;
    const documentRows = await loadDocumentRegisterRows(
      input.year,
      input.month,
      docType,
    );
    rows = documentRows.map((row, index) =>
      mapDocumentRow(row, index, docType),
    );
  }

  return {
    reportType: input.reportType,
    year: input.year,
    month: input.month,
    periodLabel: formatThaiDate(periodAnchor, "monthYear"),
    title: meta.title,
    partyColumnLabel: meta.partyColumnLabel,
    company_name: companyName,
    rows,
    totals: sumTotals(rows),
  };
}
