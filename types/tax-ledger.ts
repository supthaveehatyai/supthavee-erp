/**
 * Phase 19 — VAT Ledger / Tax Reports (ภ.พ.30).
 * Keep outside `"use server"` modules.
 */

import type { VatLedgerReportType } from "@/lib/constants/document";

export type { VatLedgerReportType };

export type VatLedgerCompanyHeader = {
  company_name: string;
  tax_id: string;
  branch_name: string;
};

export type VatLedgerLine = {
  seq: number;
  invoice_date: string;
  invoice_no: string;
  party_name: string;
  tax_id: string;
  branch_office: string;
  goods_amount: number;
  vat_amount: number;
  grand_total: number;
  status: string;
  remark: string;
  is_void: boolean;
};

export type VatLedgerReport = {
  reportType: VatLedgerReportType;
  year: number;
  month: number;
  periodLabel: string;
  title: string;
  partyColumnLabel: string;
  company: VatLedgerCompanyHeader;
  rows: VatLedgerLine[];
  totals: {
    goods_amount: number;
    vat_amount: number;
    grand_total: number;
  };
};
