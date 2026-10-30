import ExcelJS from "exceljs";
import type { CashReceiptBill } from "@/types/cash-receipt";

const HEADER_FILL: ExcelJS.FillPattern = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1E3A5F" },
};

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.fill = HEADER_FILL;
  row.alignment = { vertical: "middle", wrapText: true };
}

export async function buildCashReceiptWorkbook(
  bills: CashReceiptBill[],
  sellerMode: "name" | "cash",
): Promise<ExcelJS.Buffer> {
  const workbook = new ExcelJS.Workbook();
  const cover = workbook.addWorksheet("รายงานสรุปใบรับเงิน_CA");
  cover.addRow([
    "ลำดับที่",
    "วัน/เดือน/ปี",
    "เลขที่",
    "ชื่อผู้ขาย/รายการ",
    "เลขประจำตัวผู้เสียภาษีอากร",
    "สถานประกอบการ",
    "รวมเงิน",
    "มูลค่าสินค้าหรือบริการ",
    "ภาษี",
  ]);
  styleHeader(cover.getRow(1));
  bills.forEach((bill, index) => {
    const rowNumber = index + 2;
    cover.addRow([
      index + 1,
      bill.docDate,
      bill.cashReceiptNo ?? "",
      sellerMode === "cash" ? "ขายสด/ซื้อสด" : bill.vendorName,
      bill.vendorTaxId ?? "",
      "สด",
      bill.grandTotal,
      { formula: `ROUND(G${rowNumber}*100/107,2)` },
      { formula: `G${rowNumber}-H${rowNumber}` },
    ]);
  });
  const totalRow = bills.length + 2;
  if (bills.length === 0) {
    cover.addRow(["", "", "", "", "", "รวม", 0, 0, 0]);
  } else {
    cover.addRow([
      "",
      "",
      "",
      "",
      "",
      "รวม",
      { formula: `SUM(G2:G${totalRow - 1})` },
      { formula: `SUM(H2:H${totalRow - 1})` },
      { formula: `SUM(I2:I${totalRow - 1})` },
    ]);
  }
  cover.getRow(totalRow).font = { bold: true };
  cover.columns.forEach((column) => {
    column.width = 18;
  });

  const detail = workbook.addWorksheet("รายละเอียดสินค้า_ใบรับเงิน_1_2");
  detail.addRow([
    "เลขที่ใบรับเงิน",
    "วันที่",
    "ผู้รับเงิน",
    "ลำดับที่",
    "รายการ",
    "จำนวน",
    "ราคา",
    "จำนวนเงิน",
  ]);
  styleHeader(detail.getRow(1));
  for (const bill of bills) {
    bill.lines.forEach((line, index) => {
      detail.addRow([
        bill.cashReceiptNo ?? bill.docNo,
        bill.docDate,
        bill.vendorName,
        index + 1,
        line.description,
        line.qty,
        line.unitPrice,
        line.amount,
      ]);
    });
  }
  detail.columns.forEach((column) => {
    column.width = 22;
  });
  return workbook.xlsx.writeBuffer();
}
