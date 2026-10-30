"use client";

import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import type { CashReceiptBill } from "@/types/cash-receipt";

export const CASH_RECEIPT_COMPANY = "บริษัททรัพย์ทวี หาดใหญ่ จำกัด";
export const CASH_RECEIPT_TAX_ID = "0905564000520";

function money(value: number): string {
  return value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function qtyLabel(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 4 });
}

export function thaiFullDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return iso || "—";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return new Intl.DateTimeFormat("th-TH", {
    calendar: "buddhist",
    numberingSystem: "latn",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}

export function CashReceiptPrintSet({
  bills,
  sellerMode,
}: {
  bills: CashReceiptBill[];
  sellerMode: "name" | "cash";
}) {
  const grand = bills.reduce((sum, bill) => sum + bill.grandTotal, 0);
  const base = bills.reduce((sum, bill) => sum + bill.goodsBase, 0);
  const vat = bills.reduce((sum, bill) => sum + bill.vatPortion, 0);

  return (
    <div className="cash-pack-print bg-white text-black">
      <section className="cash-cover">
        <h2 className="text-center text-lg font-bold">รายงานบิลซื้อ (แบบไม่มี VAT) / ใบรับเงิน CA</h2>
        <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
          <p>ชื่อผู้ประกอบการ {CASH_RECEIPT_COMPANY}</p>
          <p>เลขประจำตัวผู้เสียภาษีอากร {CASH_RECEIPT_TAX_ID}</p>
          <p>[✓] สำนักงานใหญ่</p>
        </div>
        <table className="mt-3 w-full border-collapse text-[11px]">
          <thead>
            <tr>
              {[
                "ลำดับที่",
                "วัน/เดือน/ปี",
                "เลขที่",
                "ชื่อผู้ขาย/รายการ",
                "เลขประจำตัวผู้เสียภาษีอากร",
                "สถานประกอบการ (โอน/สด)",
                "รวมเงิน",
                "มูลค่าสินค้าหรือบริการ",
                "ภาษี",
              ].map((heading) => (
                <th key={heading} className="border border-black px-1 py-1 text-center font-semibold">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bills.map((bill, index) => (
              <tr key={bill.id}>
                <td className="border border-black px-1 py-1 text-center">{index + 1}</td>
                <td className="border border-black px-1 py-1 text-center">{formatThaiDate(bill.docDate, "short")}</td>
                <td className="border border-black px-1 py-1 text-center">{bill.cashReceiptNo ?? "—"}</td>
                <td className="border border-black px-1 py-1">
                  {sellerMode === "cash" ? "ขายสด/ซื้อสด" : bill.vendorName}
                </td>
                <td className="border border-black px-1 py-1 text-center">{bill.vendorTaxId ?? ""}</td>
                <td className="border border-black px-1 py-1 text-center">สด</td>
                <td className="border border-black px-1 py-1 text-right">{money(bill.grandTotal)}</td>
                <td className="border border-black px-1 py-1 text-right">{money(bill.goodsBase)}</td>
                <td className="border border-black px-1 py-1 text-right">{money(bill.vatPortion)}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className="border border-black px-1 py-1 text-right" colSpan={6}>
                รวม
              </td>
              <td className="border border-black px-1 py-1 text-right">{money(grand)}</td>
              <td className="border border-black px-1 py-1 text-right">{money(base)}</td>
              <td className="border border-black px-1 py-1 text-right">{money(vat)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {bills.map((bill) => (
        <section key={`${bill.id}-receipt`} className="cash-receipt-sheet mt-8">
          <h2 className="text-center text-2xl font-bold">ใบรับเงิน</h2>
          <div className="mt-4 grid grid-cols-2 gap-x-6 text-sm leading-7">
            <p>ผู้รับเงิน: {bill.vendorName}</p>
            <p>เลขที่: {bill.cashReceiptNo ?? "—"}</p>
            <p>ที่อยู่: {bill.vendorAddress ?? "—"}</p>
            <p>วันที่: {thaiFullDate(bill.docDate)}</p>
            <p className="col-span-2">เลขที่ประจำตัวผู้เสียภาษี {bill.vendorTaxId ?? "—"}</p>
          </div>
          <table className="mt-4 w-full border-collapse text-sm">
            <thead>
              <tr>
                {["ลำดับที่ (ITEM)", "รายการ", "จำนวน (Quantity)", "ราคา (Price)", "จำนวนเงิน (Amount)"].map(
                  (heading) => (
                    <th key={heading} className="border border-black px-2 py-1 text-center">
                      {heading}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {bill.lines.map((line, index) => (
                <tr key={`${bill.id}-${index}`}>
                  <td className="border border-black px-2 py-1 text-center">{index + 1}</td>
                  <td className="border border-black px-2 py-1">{line.description}</td>
                  <td className="border border-black px-2 py-1 text-right">{qtyLabel(line.qty)}</td>
                  <td className="border border-black px-2 py-1 text-right">{money(line.unitPrice)}</td>
                  <td className="border border-black px-2 py-1 text-right">{money(line.amount)}</td>
                </tr>
              ))}
              <tr>
                <td className="border border-black px-2 py-1 text-right" colSpan={4}>
                  ส่วนลด
                </td>
                <td className="border border-black px-2 py-1 text-right">{money(bill.discountAmount)}</td>
              </tr>
              <tr>
                <td className="border border-black px-2 py-1" colSpan={5}>
                  จำนวนเงินตัวอักษร ({numberToThaiBaht(bill.grandTotal)})
                </td>
              </tr>
              <tr className="font-bold">
                <td className="border border-black px-2 py-1 text-right" colSpan={4}>
                  รวมราคาสินค้า
                </td>
                <td className="border border-black px-2 py-1 text-right">{money(bill.grandTotal)}</td>
              </tr>
            </tbody>
          </table>
          <div className="mt-6 text-sm leading-7">
            <p>ข้าพเจ้า {bill.vendorName} บัตรประจำตัวประชาชนเลขที่ {bill.vendorTaxId ?? "—"}</p>
            <p>ได้รับเงินค่าสินค้า จาก {CASH_RECEIPT_COMPANY} เป็นที่เรียบร้อยแล้ว</p>
          </div>
          <div className="mt-12 text-center text-sm">
            <p>ลงชื่อผู้รับเงิน ........................................................ ผู้รับเงิน</p>
            <p className="mt-2">( {bill.vendorName} )</p>
          </div>
        </section>
      ))}
    </div>
  );
}
