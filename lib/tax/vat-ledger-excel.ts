/**
 * Phase 19 — VAT Ledger Excel workbook (ภ.พ.30 layout).
 * exceljs only — no UI / no Supabase.
 */

import ExcelJS from "exceljs";
import { OUTPUT_TAX_EXCEL_SHEETS } from "@/lib/tax/output-tax-series";
import type { VatLedgerLine, VatLedgerReport } from "@/types/tax-ledger";

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

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function writeVatLedgerSheet(
  workbook: ExcelJS.Workbook,
  sheetName: string,
  report: VatLedgerReport,
  rows: VatLedgerLine[],
  sheetTitle: string,
) {
  const totals = rows.reduce(
    (acc, row) => ({
      goods_amount: roundMoney(acc.goods_amount + row.goods_amount),
      vat_amount: roundMoney(acc.vat_amount + row.vat_amount),
      grand_total: roundMoney(acc.grand_total + row.grand_total),
    }),
    { goods_amount: 0, vat_amount: 0, grand_total: 0 },
  );

  const sheet = workbook.addWorksheet(sheetName, {
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
    { key: "invoice_date", width: 16 },
    { key: "invoice_no", width: 20 },
    { key: "party_name", width: 36 },
    { key: "tax_id", width: 20 },
    { key: "branch_office", width: 18 },
    { key: "goods_amount", width: 16 },
    { key: "vat_amount", width: 16 },
    { key: "grand_total", width: 16 },
    { key: "remark", width: 12 },
  ];

  sheet.mergeCells("A1:J1");
  sheet.mergeCells("A2:J2");
  sheet.mergeCells("A3:J3");

  const taxIdSuffix = report.company.tax_id
    ? `  ·  เลขประจำตัวผู้เสียภาษี ${report.company.tax_id}`
    : "";
  applyHeaderCell(sheet.getCell("A1"), `${report.company.company_name}${taxIdSuffix}`, {
    size: 16,
  });
  applyHeaderCell(sheet.getCell("A2"), sheetTitle, { size: 14 });
  applyHeaderCell(
    sheet.getCell("A3"),
    `ประจำเดือน ${report.periodLabel}`,
    { size: 12, bold: false },
  );
  sheet.getRow(1).height = 24;
  sheet.getRow(2).height = 20;
  sheet.getRow(3).height = 18;

  const columnTitles = [
    "ลำดับ",
    "วันที่ใบกำกับภาษี",
    "เลขที่ใบกำกับภาษี",
    report.partyColumnLabel,
    "เลขประจำตัวผู้เสียภาษี",
    "สำนักงานใหญ่/สาขา",
    "มูลค่าสินค้า",
    "จำนวนเงินภาษี",
    "รวมเงิน",
    "หมายเหตุ",
  ];

  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.height = 22;
  columnTitles.forEach((title, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = title;
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });

  const dataStartRow = HEADER_ROW + 1;
  rows.forEach((line, index) => {
    const excelRow = sheet.getRow(dataStartRow + index);
    excelRow.getCell("seq").value = index + 1;
    excelRow.getCell("invoice_date").value = line.invoice_date;
    excelRow.getCell("invoice_no").value = line.invoice_no;
    excelRow.getCell("party_name").value = line.party_name;
    excelRow.getCell("tax_id").value = line.tax_id;
    excelRow.getCell("branch_office").value = line.branch_office;
    excelRow.getCell("goods_amount").value = line.goods_amount;
    excelRow.getCell("vat_amount").value = line.vat_amount;
    excelRow.getCell("grand_total").value = line.grand_total;
    excelRow.getCell("remark").value = line.remark;
    excelRow.alignment = { vertical: "middle" };
    excelRow.getCell("tax_id").numFmt = "@";
    excelRow.getCell("goods_amount").numFmt = MONEY_FORMAT;
    excelRow.getCell("vat_amount").numFmt = MONEY_FORMAT;
    excelRow.getCell("grand_total").numFmt = MONEY_FORMAT;
    excelRow.getCell("goods_amount").alignment = { horizontal: "right" };
    excelRow.getCell("vat_amount").alignment = { horizontal: "right" };
    excelRow.getCell("grand_total").alignment = { horizontal: "right" };
    excelRow.getCell("seq").alignment = { horizontal: "center" };
    excelRow.getCell("invoice_date").alignment = { horizontal: "center" };
    if (line.is_void) {
      excelRow.font = VOID_FONT;
    }
  });

  const totalRow = sheet.getRow(dataStartRow + rows.length);
  totalRow.getCell("party_name").value = "รวมทั้งสิ้น";
  totalRow.getCell("goods_amount").value = totals.goods_amount;
  totalRow.getCell("vat_amount").value = totals.vat_amount;
  totalRow.getCell("grand_total").value = totals.grand_total;
  totalRow.font = { name: "Calibri", bold: true };
  for (let col = 1; col <= 10; col += 1) {
    totalRow.getCell(col).fill = TOTAL_FILL;
    totalRow.getCell(col).font = { name: "Calibri", bold: true };
  }
  totalRow.getCell("goods_amount").numFmt = MONEY_FORMAT;
  totalRow.getCell("vat_amount").numFmt = MONEY_FORMAT;
  totalRow.getCell("grand_total").numFmt = MONEY_FORMAT;
  totalRow.getCell("party_name").alignment = { horizontal: "right" };
  totalRow.getCell("goods_amount").alignment = { horizontal: "right" };
  totalRow.getCell("vat_amount").alignment = { horizontal: "right" };
  totalRow.getCell("grand_total").alignment = { horizontal: "right" };
}

export async function buildVatLedgerWorkbook(
  report: VatLedgerReport,
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Supthavee ERP";
  workbook.created = new Date();

  if (report.reportType === "OUTPUT_TAX") {
    for (const sheet of OUTPUT_TAX_EXCEL_SHEETS) {
      const rows =
        sheet.key === "ALL"
          ? report.rows
          : report.rows.filter((row) => row.output_group === sheet.key);
      writeVatLedgerSheet(
        workbook,
        sheet.name,
        report,
        rows,
        `${report.title} · ${sheet.name}`,
      );
    }
  } else {
    writeVatLedgerSheet(workbook, report.title, report, report.rows, report.title);
  }

  return workbook.xlsx.writeBuffer();
}
