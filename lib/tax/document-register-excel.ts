/**
 * Report Center — Document Register Excel + timestamped filenames.
 * exceljs only — no UI / no Supabase.
 */

import ExcelJS from "exceljs";
import type { FinanceReportType } from "@/lib/constants/document";
import type { DocumentRegisterReport } from "@/types/finance-report";

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};
const TOTAL_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE2E8F0" },
};
const VOID_FONT: Partial<ExcelJS.Font> = {
  color: { argb: "FFB91C1C" },
  italic: true,
};
const MONEY_FORMAT = "#,##0.00";
const HEADER_ROW = 4;

function applyHeaderCell(
  cell: ExcelJS.Cell,
  value: string,
  options?: { size?: number; bold?: boolean },
) {
  cell.value = value;
  cell.font = {
    name: "Calibri",
    bold: options?.bold !== false,
    size: options?.size ?? 14,
    color: { argb: "FF0F172A" },
  };
  cell.alignment = { vertical: "middle", horizontal: "left" };
}

export function financeReportFilename(
  reportType: FinanceReportType,
  timestamp: string,
): string {
  if (reportType === "OUTPUT_TAX") {
    return `VAT_OUTPUT_TAX_${timestamp}.xlsx`;
  }
  if (reportType === "INPUT_TAX") {
    return `VAT_INPUT_TAX_${timestamp}.xlsx`;
  }
  return `REGISTER_${reportType}_${timestamp}.xlsx`;
}

export async function buildDocumentRegisterWorkbook(
  report: DocumentRegisterReport,
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Supthavee ERP";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(report.title, {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
    pageSetup: {
      paperSize: 9,
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: {
        left: 0.4,
        right: 0.4,
        top: 0.5,
        bottom: 0.5,
        header: 0.2,
        footer: 0.2,
      },
    },
  });

  sheet.columns = [
    { key: "seq", width: 8 },
    { key: "doc_date", width: 16 },
    { key: "doc_no", width: 22 },
    { key: "party_name", width: 36 },
    { key: "net_before_vat", width: 16 },
    { key: "vat_amount", width: 14 },
    { key: "grand_total", width: 16 },
    { key: "status", width: 14 },
  ];

  sheet.mergeCells("A1:H1");
  sheet.mergeCells("A2:H2");
  sheet.mergeCells("A3:H3");

  applyHeaderCell(sheet.getCell("A1"), report.company_name, { size: 16 });
  applyHeaderCell(sheet.getCell("A2"), report.title, { size: 14 });
  applyHeaderCell(sheet.getCell("A3"), `ประจำเดือน ${report.periodLabel}`, {
    size: 12,
    bold: false,
  });
  sheet.getRow(1).height = 24;
  sheet.getRow(2).height = 20;
  sheet.getRow(3).height = 18;

  const columnTitles = [
    "ลำดับ",
    "วันที่",
    "เลขเอกสาร",
    report.partyColumnLabel,
    "ยอดก่อนภาษี",
    "ภาษี",
    "ยอดสุทธิ",
    "สถานะ",
  ];

  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.height = 22;
  columnTitles.forEach((title, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = title;
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = {
      vertical: "middle",
      horizontal: "center",
      wrapText: true,
    };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });

  const dataStartRow = HEADER_ROW + 1;
  report.rows.forEach((line, index) => {
    const excelRow = sheet.getRow(dataStartRow + index);
    excelRow.getCell("seq").value = line.seq;
    excelRow.getCell("doc_date").value = line.doc_date;
    excelRow.getCell("doc_no").value = line.doc_no;
    excelRow.getCell("party_name").value = line.party_name;
    excelRow.getCell("net_before_vat").value = line.net_before_vat;
    excelRow.getCell("vat_amount").value = line.vat_amount;
    excelRow.getCell("grand_total").value = line.grand_total;
    excelRow.getCell("status").value = line.status_label;
    excelRow.alignment = { vertical: "middle" };
    excelRow.getCell("net_before_vat").numFmt = MONEY_FORMAT;
    excelRow.getCell("vat_amount").numFmt = MONEY_FORMAT;
    excelRow.getCell("grand_total").numFmt = MONEY_FORMAT;
    excelRow.getCell("seq").alignment = { horizontal: "center" };
    excelRow.getCell("doc_date").alignment = { horizontal: "center" };
    excelRow.getCell("net_before_vat").alignment = { horizontal: "right" };
    excelRow.getCell("vat_amount").alignment = { horizontal: "right" };
    excelRow.getCell("grand_total").alignment = { horizontal: "right" };
    excelRow.getCell("status").alignment = { horizontal: "center" };
    if (line.is_void) {
      excelRow.font = VOID_FONT;
    }
  });

  const totalRow = sheet.getRow(dataStartRow + report.rows.length);
  totalRow.getCell("party_name").value = "รวมทั้งสิ้น";
  totalRow.getCell("net_before_vat").value = report.totals.net_before_vat;
  totalRow.getCell("vat_amount").value = report.totals.vat_amount;
  totalRow.getCell("grand_total").value = report.totals.grand_total;
  for (let col = 1; col <= 8; col += 1) {
    totalRow.getCell(col).fill = TOTAL_FILL;
    totalRow.getCell(col).font = { name: "Calibri", bold: true };
  }
  totalRow.getCell("net_before_vat").numFmt = MONEY_FORMAT;
  totalRow.getCell("vat_amount").numFmt = MONEY_FORMAT;
  totalRow.getCell("grand_total").numFmt = MONEY_FORMAT;
  totalRow.getCell("party_name").alignment = { horizontal: "right" };
  totalRow.getCell("net_before_vat").alignment = { horizontal: "right" };
  totalRow.getCell("vat_amount").alignment = { horizontal: "right" };
  totalRow.getCell("grand_total").alignment = { horizontal: "right" };

  return workbook.xlsx.writeBuffer();
}
