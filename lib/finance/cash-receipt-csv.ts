import type { CashReceiptBill } from "@/types/cash-receipt";

function cell(value: string | number): string {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

export function buildCashReceiptCsv(bills: CashReceiptBill[], sellerMode: "name" | "cash"): string {
  const header = [
    "ลำดับที่",
    "วัน/เดือน/ปี",
    "เลขที่",
    "ชื่อผู้ขาย/รายการ",
    "เลขประจำตัวผู้เสียภาษีอากร",
    "สถานประกอบการ",
    "รวมเงิน",
    "มูลค่าสินค้าหรือบริการ",
    "ภาษี",
  ];
  const lines = [header.map(cell).join(",")];
  bills.forEach((bill, index) => {
    lines.push(
      [
        index + 1,
        bill.docDate,
        bill.cashReceiptNo ?? "",
        sellerMode === "cash" ? "ขายสด/ซื้อสด" : bill.vendorName,
        bill.vendorTaxId ?? "",
        "สด",
        bill.grandTotal.toFixed(2),
        bill.goodsBase.toFixed(2),
        bill.vatPortion.toFixed(2),
      ]
        .map(cell)
        .join(","),
    );
  });
  const grand = bills.reduce((sum, bill) => sum + bill.grandTotal, 0);
  const base = bills.reduce((sum, bill) => sum + bill.goodsBase, 0);
  const vat = bills.reduce((sum, bill) => sum + bill.vatPortion, 0);
  lines.push(
    ["", "", "", "", "", "รวม", grand.toFixed(2), base.toFixed(2), vat.toFixed(2)].map(cell).join(","),
  );
  return `\uFEFF${lines.join("\r\n")}`;
}
