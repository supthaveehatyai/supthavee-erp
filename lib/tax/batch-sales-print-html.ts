/**
 * หน้าพิมพ์ใบกำกับภาษีอย่างย่อแบบ Batch — 1 บิลต่อ 1 หน้า
 * ใช้ฝั่งเบราว์เซอร์ก่อน window.print() ไม่มี `"use server"`
 */

import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import type { BatchSalesPdfDocument, BatchSalesPdfItem } from "@/types/batch-sales-pdf";

const COMPANY_NAME = "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด (สำนักงานใหญ่)";
const COMPANY_TAX_ID = "0-9055-64000-52-0";

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDocDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return iso || "—";
  return `${match[3]}/${match[2]}/${Number(match[1]) + 543}`;
}

function heading(doc: BatchSalesPdfDocument): string {
  if (doc.doc_type === "CS_TAX") return "ใบเสร็จรับเงิน / ใบกำกับภาษี";
  if (doc.doc_type === "TAX_INV") return "ใบกำกับภาษี / ใบส่งของ";
  if (doc.doc_type === "DEP_IN") return "ใบรับเงินมัดจำ / ใบกำกับภาษี";
  return "ใบกำกับภาษีอย่างย่อ";
}

function collapseItems(items: BatchSalesPdfItem[]): Array<{
  description: string;
  qty: number;
  uom: string;
  amount: number;
}> {
  const grouped = new Map<string, { description: string; qty: number; uom: string; amount: number }>();
  for (const item of items) {
    const description = item.description.trim() || "สินค้า";
    const uom = item.uom_used.trim() || "ตัว";
    const key = `${description}|${uom}`;
    const current = grouped.get(key);
    if (current) {
      current.qty += item.qty;
      current.amount += item.line_total;
    } else {
      grouped.set(key, {
        description,
        qty: item.qty,
        uom,
        amount: item.line_total,
      });
    }
  }
  return Array.from(grouped.values());
}

function qtyText(qty: number): string {
  const rounded = Math.round(qty * 1000) / 1000;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString("th-TH")
    : rounded.toLocaleString("th-TH", { maximumFractionDigits: 3 });
}

function renderBill(doc: BatchSalesPdfDocument): string {
  const items = collapseItems(doc.items);
  const rows = items.length
    ? items
        .map(
          (item, index) => `<tr>
            <td class="center">${index + 1}</td>
            <td>${esc(item.description)}</td>
            <td class="right">${qtyText(item.qty)}</td>
            <td class="center">${esc(item.uom)}</td>
            <td class="right">${money(item.amount)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="5" class="center muted">ไม่มีรายการสินค้า</td></tr>`;
  const voided =
    doc.is_voided || doc.status.toUpperCase() === "VOID" || doc.status.toUpperCase() === "CANCELLED";
  const customerTax = doc.customer_tax_id
    ? `<div>เลขผู้เสียภาษีลูกค้า ${esc(doc.customer_tax_id)}</div>`
    : "";
  const address = doc.customer_address ? `<div>${esc(doc.customer_address)}</div>` : "";

  return `<section class="bill">
    <header>
      <div class="company">${COMPANY_NAME}</div>
      <div class="tax">เลขประจำตัวผู้เสียภาษี ${COMPANY_TAX_ID}</div>
      <h1>${esc(heading(doc))}</h1>
    </header>
    ${voided ? `<div class="void">ยกเลิก</div>` : ""}
    <div class="meta">
      <div><strong>เลขที่</strong> ${esc(doc.doc_no || "—")}</div>
      <div><strong>วันที่</strong> ${esc(formatDocDate(doc.doc_date))}</div>
    </div>
    <div class="customer">
      <div><strong>ลูกค้า</strong> ${esc(doc.customer_name)}</div>
      ${customerTax}
      ${address}
    </div>
    <table>
      <thead>
        <tr>
          <th class="center">#</th>
          <th>รายการ</th>
          <th class="right">จำนวน</th>
          <th class="center">หน่วย</th>
          <th class="right">จำนวนเงิน</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="baht">(${esc(numberToThaiBaht(doc.grand_total))})</div>
    <table class="summary">
      <tr><th>ยอดเงินก่อน VAT</th><td>${money(doc.net_before_vat)}</td></tr>
      <tr><th>VAT 7%</th><td>${money(doc.vat_amount)}</td></tr>
      <tr class="grand"><th>ยอดสุทธิ</th><td>${money(doc.grand_total)}</td></tr>
    </table>
  </section>`;
}

export function buildBatchSalesPrintHtml(documents: BatchSalesPdfDocument[]): string {
  const body = documents.map(renderBill).join("");
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>Batch PDF ใบกำกับภาษี</title>
  <style>
    @page { size: A5 portrait; margin: 8mm; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #0f172a; font-family: Tahoma, "Sarabun", sans-serif; font-size: 11px; }
    .bill { position: relative; page-break-after: always; break-after: page; }
    .bill:last-child { page-break-after: auto; break-after: auto; }
    header { text-align: center; margin-bottom: 8px; }
    .company { font-size: 14px; font-weight: 700; }
    .tax { margin-top: 2px; font-size: 11px; }
    h1 { margin: 6px 0 0; font-size: 13px; }
    .meta, .customer { display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px; }
    .meta { flex-direction: row; justify-content: space-between; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #cbd5e1; padding: 3px 5px; vertical-align: top; }
    th { background: #f8fafc; font-weight: 700; }
    .right { text-align: right; white-space: nowrap; }
    .center { text-align: center; }
    .muted { color: #64748b; }
    .baht { margin: 6px 0; text-align: right; }
    .summary { width: 230px; margin-left: auto; }
    .summary th { text-align: left; background: #fff; }
    .summary td { text-align: right; font-variant-numeric: tabular-nums; }
    .summary .grand th, .summary .grand td { font-weight: 700; background: #f1f5f9; }
    .void {
      position: absolute; top: 42%; left: 50%; transform: translate(-50%, -50%) rotate(-18deg);
      color: rgba(185, 28, 28, 0.35); font-size: 42px; font-weight: 800; letter-spacing: 4px;
    }
  </style>
</head>
<body>${body}</body>
</html>`;
}
