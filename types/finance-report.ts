/**
 * Report Center — preview rows + document register Excel.
 * Keep outside `"use server"` modules.
 */

import type {
  DocumentRegisterReportType,
  FinanceReportType,
  VatLedgerReportType,
} from "@/lib/constants/document";

export type {
  DocumentRegisterReportType,
  FinanceReportType,
  VatLedgerReportType,
};

export type ReportCenterPreviewRow = {
  seq: number;
  doc_date: string;
  doc_no: string;
  party_name: string;
  net_before_vat: number;
  vat_amount: number;
  grand_total: number;
  status: string;
  status_label: string;
  is_void: boolean;
};

export type ReportCenterPreview = {
  reportType: FinanceReportType;
  year: number;
  month: number;
  periodLabel: string;
  title: string;
  partyColumnLabel: string;
  rows: ReportCenterPreviewRow[];
  totals: {
    net_before_vat: number;
    vat_amount: number;
    grand_total: number;
  };
};

export type DocumentRegisterReport = {
  reportType: DocumentRegisterReportType;
  year: number;
  month: number;
  periodLabel: string;
  title: string;
  partyColumnLabel: string;
  company_name: string;
  rows: ReportCenterPreviewRow[];
  totals: {
    net_before_vat: number;
    vat_amount: number;
    grand_total: number;
  };
};
