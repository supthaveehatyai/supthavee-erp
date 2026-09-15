/**
 * Report Center preview loader — Server Component / Route Handler only.
 */

import {
  getDocumentStatusLabel,
  isDocumentRegisterReportType,
  isVatLedgerReportType,
  type FinanceReportType,
} from "@/lib/constants/document";
import { loadDocumentRegisterReport } from "@/lib/tax/document-register-data";
import { loadVatLedgerReport } from "@/lib/tax/vat-ledger-data";
import type { ReportCenterPreview } from "@/types/finance-report";
import type { VatLedgerReport } from "@/types/tax-ledger";

function mapVatLedgerToPreview(report: VatLedgerReport): ReportCenterPreview {
  return {
    reportType: report.reportType,
    year: report.year,
    month: report.month,
    periodLabel: report.periodLabel,
    title: report.title,
    partyColumnLabel: report.partyColumnLabel,
    rows: report.rows.map((row) => ({
      seq: row.seq,
      doc_date: row.invoice_date,
      doc_no: row.invoice_no,
      party_name: row.party_name,
      net_before_vat: row.goods_amount,
      vat_amount: row.vat_amount,
      grand_total: row.grand_total,
      status: row.status,
      status_label: getDocumentStatusLabel(row.status),
      is_void: row.is_void,
    })),
    totals: {
      net_before_vat: report.totals.goods_amount,
      vat_amount: report.totals.vat_amount,
      grand_total: report.totals.grand_total,
    },
  };
}

export async function loadReportCenterPreview(input: {
  year: number;
  month: number;
  reportType: FinanceReportType;
}): Promise<ReportCenterPreview> {
  if (isVatLedgerReportType(input.reportType)) {
    const report = await loadVatLedgerReport({
      year: input.year,
      month: input.month,
      reportType: input.reportType,
    });
    return mapVatLedgerToPreview(report);
  }

  if (isDocumentRegisterReportType(input.reportType)) {
    const report = await loadDocumentRegisterReport({
      year: input.year,
      month: input.month,
      reportType: input.reportType,
    });
    return {
      reportType: report.reportType,
      year: report.year,
      month: report.month,
      periodLabel: report.periodLabel,
      title: report.title,
      partyColumnLabel: report.partyColumnLabel,
      rows: report.rows,
      totals: report.totals,
    };
  }

  throw new Error("ประเภทรายงานไม่รองรับ");
}
