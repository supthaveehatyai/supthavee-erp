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

function compactThaiDate(value: string): string {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value.trim());
  if (!match) return value;
  return `${match[1]}/${match[2]}/${match[3].slice(-2)}`;
}

function writeAbbDailySummarySheet(
  workbook: ExcelJS.Workbook,
  report: VatLedgerReport,
  rows: VatLedgerLine[],
) {
  const daysInMonth = new Date(report.year, report.month, 0).getDate();
  const mm = String(report.month).padStart(2, "0");
  const yy = String((report.year + 543) % 100).padStart(2, "0");
  const byDay = new Map<number, VatLedgerLine[]>();
  for (const row of rows) {
    const match = /^(\d{2})\//.exec(row.invoice_date.trim());
    const day = match ? Number(match[1]) : 0;
    if (day < 1 || day > daysInMonth) continue;
    const bucket = byDay.get(day) ?? [];
    bucket.push(row);
    byDay.set(day, bucket);
  }

  const sheet = workbook.addWorksheet("ABB_สรุปรายวัน", {
    views: [{ state: "frozen", ySplit: HEADER_ROW }],
    pageSetup: {
      paperSize: 9,
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      horizontalCentered: true,
      margins: {
        left: 0.25,
        right: 0.25,
        top: 0.35,
        bottom: 0.35,
        header: 0.2,
        footer: 0.2,
      },
    },
  });
  sheet.columns = [
    { width: 5 },
    { width: 10 },
    { width: 26 },
    { width: 9 },
    { width: 13 },
    { width: 11 },
    { width: 13 },
    { width: 12 },
    { width: 13 },
  ];
  sheet.mergeCells("A1:I1");
  sheet.mergeCells("A2:I2");
  sheet.mergeCells("A3:I3");
  applyHeaderCell(
    sheet.getCell("A1"),
    "รายงานภาษีขาย (ขายสดหน้าร้าน) — บิลเงินสด/ใบกำกับภาษีอย่างย่อ (ABB)",
    { size: 11 },
  );
  applyHeaderCell(
    sheet.getCell("A2"),
    "ชื่อผู้ประกอบการ: บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด (สำนักงานใหญ่) · เลขประจำตัวผู้เสียภาษีอากร: 0905564000520",
    { size: 9.5, bold: false },
  );
  applyHeaderCell(sheet.getCell("A3"), `ประจำเดือน ${report.periodLabel}`, {
    size: 9.5,
    bold: false,
  });
  sheet.getRow(1).height = 18;
  sheet.getRow(2).height = 16.5;
  sheet.getRow(3).height = 16.5;

  const titles = [
    "ลำดับ",
    "วัน/เดือน/ปี",
    "เลขที่ใบกำกับภาษี (รหัสเต็ม)",
    "ชื่อผู้ซื้อ",
    "มูลค่าสินค้า/บริการ",
    "ภาษีขาย (7%)",
    "รวมเงิน (ฐาน+VAT)",
    "ค่าขนส่งยกเว้น VAT",
    "รวมรับสุทธิ",
  ];
  const headerRow = sheet.getRow(HEADER_ROW);
  headerRow.height = 16.5;
  titles.forEach((title, index) => {
    const cell = headerRow.getCell(index + 1);
    cell.value = title;
    cell.font = { name: "Calibri", bold: true, size: 9.5, color: { argb: "FFFFFFFF" } };
    cell.fill = HEADER_FILL;
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });

  const totals = { goods: 0, vat: 0, basePlusVat: 0, freight: 0, grand: 0 };
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayRows = (byDay.get(day) ?? []).slice().sort((a, b) =>
      a.invoice_no.localeCompare(b.invoice_no, "en"),
    );
    const active = dayRows.filter((row) => !row.is_void);
    const goods = roundMoney(active.reduce((sum, row) => sum + row.goods_amount, 0));
    const vat = roundMoney(active.reduce((sum, row) => sum + row.vat_amount, 0));
    const grand = roundMoney(active.reduce((sum, row) => sum + row.grand_total, 0));
    const basePlusVat = roundMoney(goods + vat);
    const freight = roundMoney(grand - basePlusVat);
    totals.goods = roundMoney(totals.goods + goods);
    totals.vat = roundMoney(totals.vat + vat);
    totals.basePlusVat = roundMoney(totals.basePlusVat + basePlusVat);
    totals.freight = roundMoney(totals.freight + freight);
    totals.grand = roundMoney(totals.grand + grand);
    const numbers = dayRows.map((row) => row.invoice_no).filter(Boolean);
    const range =
      numbers.length === 0
        ? "-"
        : numbers.length === 1
          ? numbers[0]
          : `${numbers[0]} - ${numbers[numbers.length - 1]}`;
    const excelRow = sheet.getRow(HEADER_ROW + day);
    excelRow.height = 16.5;
    excelRow.font = { name: "Calibri", size: 9.5 };
    const values = [
      day,
      `${String(day).padStart(2, "0")}/${mm}/${yy}`,
      range,
      "ขายสด",
      goods,
      vat,
      basePlusVat,
      freight,
      grand,
    ];
    values.forEach((value, index) => {
      const cell = excelRow.getCell(index + 1);
      cell.value = value ?? "";
      cell.font = { name: "Calibri", size: 9.5 };
      cell.alignment = {
        vertical: "middle",
        horizontal: index >= 4 ? "right" : index === 0 || index === 1 ? "center" : "left",
      };
      if (index >= 4) cell.numFmt = MONEY_FORMAT;
    });
  }

  const totalRow = sheet.getRow(HEADER_ROW + daysInMonth + 1);
  totalRow.height = 16.5;
  totalRow.getCell(3).value = "รวมทั้งสิ้น";
  totalRow.getCell(5).value = totals.goods;
  totalRow.getCell(6).value = totals.vat;
  totalRow.getCell(7).value = totals.basePlusVat;
  totalRow.getCell(8).value = totals.freight;
  totalRow.getCell(9).value = totals.grand;
  for (let col = 1; col <= 9; col += 1) {
    const cell = totalRow.getCell(col);
    cell.fill = TOTAL_FILL;
    cell.font = { name: "Calibri", bold: true, size: 9.5 };
    if (col >= 5) {
      cell.numFmt = MONEY_FORMAT;
      cell.alignment = { horizontal: "right" };
    }
  }
  totalRow.getCell(3).alignment = { horizontal: "right" };
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
      orientation: "portrait",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      printTitlesRow: "1:4",
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
    { key: "seq", width: 5 },
    { key: "invoice_date", width: 10 },
    { key: "invoice_no", width: 15 },
    { key: "party_name", width: 14 },
    { key: "tax_id", width: 12 },
    { key: "branch_office", width: 8 },
    { key: "goods_amount", width: 10 },
    { key: "vat_amount", width: 9 },
    { key: "grand_total", width: 10 },
    { key: "remark", width: 6 },
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
    excelRow.getCell("invoice_date").value = compactThaiDate(line.invoice_date);
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
    excelRow.getCell("party_name").alignment = {
      vertical: "middle",
      horizontal: "left",
      wrapText: true,
    };
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
      if (sheet.key === "ABB") {
        writeAbbDailySummarySheet(workbook, report, rows);
      }
    }
  } else {
    writeVatLedgerSheet(workbook, report.title, report, report.rows, report.title);
  }

  return workbook.xlsx.writeBuffer();
}
