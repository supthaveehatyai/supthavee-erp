import ExcelJS from "exceljs";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { paymentTimeLabel } from "@/lib/utils/payment-timestamp";
import type { PaymentRegisterData, PaymentRegisterEntry, PaymentRegisterLine } from "@/types/payment-register";

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
const MONEY = "#,##0.00";

const DETAIL_HEADERS = [
  "ลำดับ",
  "วันที่ชำระ",
  "เวลาที่ชำระ",
  "เลขที่ใบสำคัญ",
  "ชื่อคู่ค้า",
  "เลขผู้เสียภาษี",
  "ช่องทางชำระ (เงินสด/ธนาคาร)",
  "เลขที่บัญชีธนาคาร",
  "เลขอ้างอิงสลิป/เช็ค",
  "เลขที่ใบวางบิล",
  "เลขที่บิลที่ตัดชำระ",
  "ยอดตามบิล",
  "หัก ณ ที่จ่าย (WHT)",
  "ยอดสุทธิ (บาท)",
  "ลิงก์รูปสลิปโอนเงิน",
  "หมายเหตุ",
];

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
    cell.font = { name: "Calibri", bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
  row.height = 22;
}

function invoiceLabel(line: PaymentRegisterLine): string {
  if (line.referenceNo && line.referenceNo !== line.invoiceDocNo) {
    return `${line.invoiceDocNo} / ${line.referenceNo}`;
  }
  return line.invoiceDocNo;
}

function writeDetailSheet(
  workbook: ExcelJS.Workbook,
  name: string,
  title: string,
  docHeading: string,
  docColumn: string,
  rows: PaymentRegisterEntry[],
) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow([title]);
  sheet.getRow(1).font = { name: "Calibri", bold: true, size: 16 };
  sheet.addRow([docHeading]);
  sheet.addRow([]);
  const headers = DETAIL_HEADERS.map((label) => (label === "เลขที่ใบสำคัญ" ? docColumn : label));
  const header = sheet.addRow(headers);
  styleHeader(header);
  let index = 0;
  let billTotal = 0;
  let whtTotal = 0;
  let netTotal = 0;
  for (const entry of rows) {
    const lines = entry.lines.length
      ? entry.lines
      : [
          {
            invoiceDocNo: "—",
            referenceNo: null,
            billingNoteNo: null,
            billAmount: entry.amount,
            whtAmount: 0,
            netAmount: entry.amount,
          },
        ];
    for (const line of lines) {
      index += 1;
      billTotal += line.billAmount;
      whtTotal += line.whtAmount;
      netTotal += line.netAmount;
      const data = sheet.addRow([
        index,
        formatThaiDate(entry.paidAt, "short"),
        paymentTimeLabel(entry.paidAt),
        entry.docNo,
        entry.contactName,
        entry.taxId ?? "",
        entry.channelLabel,
        entry.accountNo ?? "",
        entry.referenceNo ?? "",
        line.billingNoteNo ?? "",
        invoiceLabel(line),
        line.billAmount,
        line.whtAmount,
        line.netAmount,
        entry.slipUrl ?? "",
        entry.notes ?? "",
      ]);
      for (const column of [12, 13, 14]) {
        data.getCell(column).numFmt = MONEY;
      }
    }
  }
  const total = sheet.addRow([
    "",
    "",
    "",
    "",
    "รวมทั้งสิ้น (Grand Total)",
    "",
    "",
    "",
    "",
    "",
    "",
    billTotal,
    whtTotal,
    netTotal,
    "",
    "",
  ]);
  total.font = { bold: true };
  total.eachCell((cell) => {
    cell.fill = TOTAL_FILL;
  });
  for (const column of [12, 13, 14]) total.getCell(column).numFmt = MONEY;
  sheet.columns = headers.map((label) => ({ width: Math.max(14, label.length + 2) }));
  sheet.getColumn(1).width = 8;
  sheet.views = [{ state: "frozen", ySplit: 4 }];
}

export async function buildPaymentRegisterWorkbook(
  data: PaymentRegisterData,
  periodLabel: string,
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Supthavee ERP";
  const ap = data.rows.filter((row) => row.direction === "AP");
  const ar = data.rows.filter((row) => row.direction === "AR");
  writeDetailSheet(
    workbook,
    "สรุปจ่ายเงินคู่ค้า (AP)",
    "สรุปจ่ายเงินคู่ค้า (AP)",
    `บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด · ${periodLabel}`,
    "เลขที่ใบสำคัญจ่าย (PAY)",
    ap,
  );
  writeDetailSheet(
    workbook,
    "สรุปรับเงินลูกค้า (AR)",
    "สรุปรับเงินลูกค้า (AR)",
    `บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด · ${periodLabel}`,
    "เลขที่ใบเสร็จรับเงิน (REC)",
    ar,
  );
  const summary = workbook.addWorksheet("สรุปแยกตามบัญชีธนาคาร");
  summary.addRow(["สรุปแยกตามบัญชีธนาคาร"]);
  summary.getRow(1).font = { name: "Calibri", bold: true, size: 16 };
  summary.addRow([`บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด · ${periodLabel}`]);
  summary.addRow([]);
  const head = summary.addRow([
    "ช่องทาง",
    "เลขที่บัญชี",
    "เงินรับเข้า (AR)",
    "เงินจ่ายออก (AP)",
    "คงเหลือสุทธิ (รับ - จ่าย)",
  ]);
  styleHeader(head);
  let inbound = 0;
  let outbound = 0;
  for (const channel of data.channels) {
    inbound += channel.inbound;
    outbound += channel.outbound;
    const row = summary.addRow([
      channel.label,
      channel.accountNo ?? "",
      channel.inbound,
      channel.outbound,
      channel.inbound - channel.outbound,
    ]);
    for (const column of [3, 4, 5]) row.getCell(column).numFmt = MONEY;
  }
  const total = summary.addRow(["รวมทั้งสิ้น (Grand Total)", "", inbound, outbound, inbound - outbound]);
  total.font = { bold: true };
  total.eachCell((cell) => {
    cell.fill = TOTAL_FILL;
  });
  for (const column of [3, 4, 5]) total.getCell(column).numFmt = MONEY;
  summary.columns = [
    { width: 36 },
    { width: 22 },
    { width: 22 },
    { width: 22 },
    { width: 28 },
  ];
  return workbook.xlsx.writeBuffer();
}
