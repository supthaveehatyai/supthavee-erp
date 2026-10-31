import ExcelJS from "exceljs";
import type { PayrollWorkbookSheetRow } from "@/types/payroll";

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

const MONEY = "#,##0.00";

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", wrapText: true };
  row.height = 22;
}

function moneyColumns(sheet: ExcelJS.Worksheet, columns: number[]) {
  for (const column of columns) {
    sheet.getColumn(column).numFmt = MONEY;
    sheet.getColumn(column).width = 16;
  }
}

function slipCell(url: string): ExcelJS.CellValue {
  if (!url) return "";
  return { text: "เปิดสลิป", hyperlink: url };
}

export async function buildPayrollWorkbook(input: {
  periodLabel: string;
  buddhistYear: number;
  monthRows: PayrollWorkbookSheetRow[];
  yearRows: PayrollWorkbookSheetRow[];
  ssoEmployeeTotal: number;
  ssoEmployerTotal: number;
  ssoRemittance: number;
  ssoReceiptNo: string;
  ssoReferenceNo: string;
  ssoSlipUrl: string;
  ssoReceiptFileLabel: string;
}): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Supthavee ERP";

  const salary = workbook.addWorksheet("รายงานเงินเดือนประจำเดือน");
  salary.addRow([
    `บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด — รายงานเงินเดือน ${input.periodLabel} (เฉพาะพนักงานในระบบบัญชี)`,
  ]);
  salary.mergeCells(1, 1, 1, 11);
  salary.getRow(1).font = { bold: true, size: 14 };
  salary.addRow([
    "ลำดับที่",
    "ชื่อ-สกุล",
    "เงินเดือน",
    "ค่าล่วงเวลา",
    "เบี้ยเลี้ยง",
    "รวมรายรับ",
    "ค่าประกันสังคม",
    "หัก ณ ที่จ่าย",
    "เงินได้สุทธิ",
    "ลิงก์รูปสลิปโอนเงิน",
    "ลิงก์สำเนาบัตรประชาชน",
  ]);
  styleHeader(salary.getRow(2));
  input.monthRows.forEach((row, index) => {
    const added = salary.addRow([
      index + 1,
      row.fullName,
      row.baseSalary,
      row.otAmount,
      row.allowanceAmount + row.extraIncome,
      row.grossIncome,
      row.ssoEmployeeAmount,
      row.whtTaxAmount,
      row.netPay,
      slipCell(row.slipUrl),
      row.idCardUrl ? { text: "เปิดสำเนาบัตร", hyperlink: row.idCardUrl } : "",
    ]);
    if (row.slipUrl) {
      added.getCell(10).font = {
        color: { argb: "FF1D4ED8" },
        underline: true,
      };
    }
    if (row.idCardUrl) {
      added.getCell(11).font = {
        color: { argb: "FF1D4ED8" },
        underline: true,
      };
    }
  });
  const salaryTotal = input.monthRows.reduce(
    (sum, row) => ({
      base: sum.base + row.baseSalary,
      ot: sum.ot + row.otAmount,
      allowance: sum.allowance + row.allowanceAmount + row.extraIncome,
      gross: sum.gross + row.grossIncome,
      sso: sum.sso + row.ssoEmployeeAmount,
      wht: sum.wht + row.whtTaxAmount,
      net: sum.net + row.netPay,
    }),
    { base: 0, ot: 0, allowance: 0, gross: 0, sso: 0, wht: 0, net: 0 },
  );
  salary.addRow([
    "",
    "รวม",
    salaryTotal.base,
    salaryTotal.ot,
    salaryTotal.allowance,
    salaryTotal.gross,
    salaryTotal.sso,
    salaryTotal.wht,
    salaryTotal.net,
    "",
    "",
  ]);
  salary.getRow(input.monthRows.length + 3).font = { bold: true };
  salary.getColumn(1).width = 12;
  salary.getColumn(2).width = 28;
  salary.getColumn(10).width = 24;
  salary.getColumn(11).width = 24;
  moneyColumns(salary, [3, 4, 5, 6, 7, 8, 9]);

  const sso = workbook.addWorksheet("สปส.1-10 (ประกันสังคม)");
  const insured = input.monthRows.filter((row) => row.isSsoEnrolled);
  sso.addRow([
    `สปส.1-10 ประจำเดือน ${input.periodLabel} — ผู้ประกันตนในระบบบัญชี`,
  ]);
  sso.mergeCells(1, 1, 1, 6);
  sso.getRow(1).font = { bold: true, size: 14 };
  sso.addRow([
    "ลำดับที่",
    "ชื่อ-สกุลผู้ประกันตน",
    "เลขประจำตัวประชาชน",
    "เงินสมทบผู้ประกันตน",
    "เงินสมทบนายจ้าง",
    "รวมนำส่ง",
  ]);
  styleHeader(sso.getRow(2));
  insured.forEach((row, index) => {
    sso.addRow([
      index + 1,
      row.fullName,
      row.citizenId,
      row.ssoEmployeeAmount,
      row.ssoEmployerAmount,
      row.ssoEmployeeAmount + row.ssoEmployerAmount,
    ]);
  });
  sso.addRow([
    "",
    "รวมนำส่ง สปส.",
    "",
    input.ssoEmployeeTotal,
    input.ssoEmployerTotal,
    input.ssoRemittance,
  ]);
  sso.getRow(insured.length + 3).font = { bold: true };
  const receiptStart = insured.length + 5;
  sso.getCell(receiptStart, 1).value = "เลขที่ใบเสร็จรับเงิน สปส.";
  sso.getCell(receiptStart, 2).value = input.ssoReceiptNo;
  sso.getCell(receiptStart + 1, 1).value = "หมายเลขอ้างอิง (Reference No.)";
  sso.getCell(receiptStart + 1, 2).value = input.ssoReferenceNo;
  sso.getCell(receiptStart + 2, 1).value = "ลิงก์ดาวน์โหลดใบเสร็จ";
  sso.getCell(receiptStart + 2, 2).value = input.ssoSlipUrl
    ? { text: input.ssoReceiptFileLabel, hyperlink: input.ssoSlipUrl }
    : "";
  if (input.ssoSlipUrl) {
    sso.getCell(receiptStart + 2, 2).font = {
      color: { argb: "FF1D4ED8" },
      underline: true,
    };
  }
  sso.getRow(receiptStart).font = { bold: true };
  sso.getRow(receiptStart + 1).font = { bold: true };
  sso.getColumn(1).width = 32;
  sso.getColumn(2).width = 28;
  sso.getColumn(3).width = 22;
  moneyColumns(sso, [4, 5, 6]);

  const pnd = workbook.addWorksheet("สรุป ภ.ง.ด.1 ก. ประจำปี");
  pnd.addRow([
    `สรุป ภ.ง.ด.1ก ประจำปี ${input.buddhistYear} — พนักงานในระบบบัญชี (ยอดจากงวดที่บันทึกในระบบ)`,
  ]);
  pnd.mergeCells(1, 1, 1, 6);
  pnd.getRow(1).font = { bold: true, size: 14 };
  pnd.addRow([
    "ลำดับที่",
    "เลขประจำตัวผู้เสียภาษี",
    "ชื่อ-สกุล",
    "จำนวนเดือน",
    "เงินได้พึงประเมิน",
    "ภาษีหัก ณ ที่จ่าย",
  ]);
  styleHeader(pnd.getRow(2));
  input.yearRows.forEach((row, index) => {
    pnd.addRow([
      index + 1,
      row.citizenId,
      row.fullName,
      row.monthCount,
      row.grossIncome,
      row.whtTaxAmount,
    ]);
  });
  const yearGross = input.yearRows.reduce((sum, row) => sum + row.grossIncome, 0);
  const yearWht = input.yearRows.reduce((sum, row) => sum + row.whtTaxAmount, 0);
  pnd.addRow(["", "", "รวมทั้งปี", "", yearGross, yearWht]);
  pnd.getRow(input.yearRows.length + 3).font = { bold: true };
  pnd.getColumn(1).width = 12;
  pnd.getColumn(2).width = 24;
  pnd.getColumn(3).width = 28;
  pnd.getColumn(4).width = 14;
  moneyColumns(pnd, [5, 6]);

  return workbook.xlsx.writeBuffer();
}
