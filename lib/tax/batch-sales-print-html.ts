/**
 * หน้าพิมพ์ Batch PDF — โครงเดียวกับใบกำกับภาษีอย่างย่อบนหน้าขาย
 * 1 บิลต่อ 1 หน้า A4 ใช้ฝั่งเบราว์เซอร์ก่อน window.print()
 */

import { documentPrintHeading } from "@/lib/constants/document-print-heading";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import type { BatchSalesPdfDocument, BatchSalesPdfItem } from "@/types/batch-sales-pdf";

const COMPANY_NAME = "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด (สำนักงานใหญ่)";
const COMPANY_ADDRESS = "234-235 ถนนเพชรเกษม ตำบลหาดใหญ่ อำเภอหาดใหญ่ จังหวัดสงขลา 90110";
const COMPANY_META = "เลขประจำตัวผู้เสียภาษี: 0-9055-64000-52-0 · โทร: 0864808693";

const LOGO_STAMP = `<svg viewBox="0 0 54 54" width="46" height="46" aria-hidden="true">
  <ellipse cx="27" cy="27" rx="24" ry="18" fill="none" stroke="#1d4ed8" stroke-width="1.6"/>
  <ellipse cx="27" cy="27" rx="21" ry="15" fill="none" stroke="#1d4ed8" stroke-width="0.6"/>
  <text x="27" y="25" text-anchor="middle" fill="#1d4ed8" font-size="6.2" font-weight="700" font-family="Arial, sans-serif">SUPTHAVEE</text>
  <text x="27" y="33" text-anchor="middle" fill="#1d4ed8" font-size="7" font-weight="700" font-family="Tahoma, sans-serif">ทรัพย์ทวี</text>
</svg>`;

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(value: number): string {
  const amount = Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  return amount.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function qtyText(qty: number): string {
  const rounded = Math.round(qty * 100) / 100;
  return Number.isInteger(rounded)
    ? rounded.toLocaleString("th-TH")
    : rounded.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function isVoided(doc: BatchSalesPdfDocument): boolean {
  const status = doc.status.toUpperCase();
  return doc.is_voided || status === "VOID" || status === "CANCELLED";
}

function logoMarkup(logoUrl: string): string {
  if (!logoUrl) return LOGO_STAMP;
  return `<img src="${esc(logoUrl)}" alt="โลโก้บริษัท" onerror="this.replaceWith(this.nextElementSibling)" />${LOGO_STAMP}`;
}

function lineRows(items: BatchSalesPdfItem[]): string {
  if (items.length === 0) {
    return `<tr><td colspan="6" class="center muted">ไม่มีรายการสินค้า</td></tr>`;
  }
  return items
    .map(
      (item, index) => `<tr>
        <td class="idx">${index + 1}</td>
        <td>${esc(item.description)}</td>
        <td class="right">${qtyText(item.qty)}</td>
        <td class="center">${esc(item.uom_used || "ตัว")}</td>
        <td class="right">${money(item.unit_price)}</td>
        <td class="right amount">${money(item.line_total)}</td>
      </tr>`,
    )
    .join("");
}

function summaryCard(doc: BatchSalesPdfDocument, items: BatchSalesPdfItem[]): string {
  const itemsSum = items.reduce((sum, item) => sum + Number(item.line_total || 0), 0);
  const computedDiscount =
    itemsSum - Number(doc.deposit_deducted || 0) + Number(doc.shipping_fee || 0) - Number(doc.grand_total || 0);
  const showDiscount = doc.discount_amount > 0 || computedDiscount > 0.009;
  const discountValue =
    doc.discount_amount > 0 ? doc.discount_amount : Math.max(0, computedDiscount);
  const rows = [
    `<div class="sum-row"><span>รวมเป็นเงิน (ค่าสินค้า)</span><span>${money(itemsSum)}</span></div>`,
  ];
  if (showDiscount) {
    rows.push(
      `<div class="sum-row"><span>ส่วนลดท้ายบิล</span><span>-${money(discountValue)}</span></div>`,
    );
  }
  if (doc.deposit_deducted > 0) {
    rows.push(
      `<div class="sum-row"><span>หักเงินมัดจำ</span><span>-${money(doc.deposit_deducted)}</span></div>`,
    );
  }
  rows.push(
    `<div class="sum-row"><span>มูลค่าสินค้า/บริการ (ก่อน VAT)</span><span>${money(doc.net_before_vat)}</span></div>`,
    `<div class="sum-row"><span>ภาษีมูลค่าเพิ่ม 7%</span><span>${money(doc.vat_amount)}</span></div>`,
  );
  if (doc.shipping_fee > 0) {
    rows.push(
      `<div class="sum-row"><span>ค่าจัดส่ง</span><span>+${money(doc.shipping_fee)}</span></div>`,
    );
  }
  rows.push(
    `<div class="sum-row grand"><span>ยอดสุทธิ (Grand Total)</span><span>${money(doc.grand_total)}</span></div>`,
  );
  return rows.join("");
}

function renderBill(doc: BatchSalesPdfDocument, logoUrl: string): string {
  const heading = documentPrintHeading(doc.doc_type);
  const items = doc.items;
  const totalQty = items
    .filter((item) => !item.is_service_item)
    .reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const extraCustomer = [
    doc.customer_tax_id ? `เลขประจำตัวผู้เสียภาษี: ${esc(doc.customer_tax_id)}` : "",
    doc.customer_address ? esc(doc.customer_address) : "",
  ].filter(Boolean);

  return `<div class="page-sheet">
    <div>
      <header class="doc-head">
        <div class="brand">
          <div class="logo-box">${logoMarkup(logoUrl)}</div>
          <div>
            <div class="company">${COMPANY_NAME}</div>
            <div class="muted">${COMPANY_ADDRESS}</div>
            <div class="muted">${COMPANY_META}</div>
          </div>
        </div>
        <div class="doc-id">
          <div class="doc-title">${esc(heading.title)}</div>
          <div class="doc-sub">${esc(heading.subtitle)}</div>
          <div class="doc-no">เลขที่เอกสาร : ${esc(doc.doc_no || "—")}</div>
          <div class="doc-date">วันที่: ${esc(formatThaiDate(doc.doc_date, "long"))}</div>
          ${isVoided(doc) ? `<div class="void-badge">ยกเลิกเอกสาร (VOID)</div>` : ""}
        </div>
      </header>
      <div class="customer-bar">
        <div>ลูกค้า: ${esc(doc.customer_name || "ลูกค้าทั่วไป")}</div>
        ${extraCustomer.map((line) => `<div>${line}</div>`).join("")}
      </div>
      <table class="lines">
        <colgroup>
          <col class="c-idx" />
          <col />
          <col class="c-qty" />
          <col class="c-uom" />
          <col class="c-price" />
          <col class="c-amount" />
        </colgroup>
        <thead>
          <tr>
            <th class="idx">#</th>
            <th>รายละเอียด</th>
            <th class="right">จำนวน</th>
            <th class="center">หน่วย</th>
            <th class="right">ราคา/หน่วย</th>
            <th class="right">รวม</th>
          </tr>
        </thead>
        <tbody>${lineRows(items)}</tbody>
      </table>
    </div>
    <footer class="sheet-foot">
      <div>
        <div class="qty-line">📦 รวมจำนวนสินค้า: ${qtyText(totalQty)} ตัว (${items.length.toLocaleString("th-TH")} รายการ)</div>
        <div class="baht">(${esc(numberToThaiBaht(doc.grand_total))})</div>
      </div>
      <div class="summary-card">${summaryCard(doc, items)}</div>
    </footer>
  </div>`;
}

export function buildBatchSalesPrintHtml(
  documents: BatchSalesPdfDocument[],
  logoUrl = "",
): string {
  const body = documents.map((doc) => renderBill(doc, logoUrl)).join("");
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="utf-8" />
  <title>Batch PDF ใบกำกับภาษี</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&family=Prompt:wght@400;600;700&display=swap" />
  <style>
    @page { size: A4 portrait; margin: 12mm 14mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      color: #0f172a;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
      font-family: "Sarabun", "Prompt", sans-serif;
    }
    .page-sheet {
      min-height: 268mm;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      page-break-after: always;
      break-after: page;
    }
    .page-sheet:last-child { page-break-after: auto; break-after: auto; }
    .doc-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .brand { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
    .logo-box {
      width: 54px; height: 54px; border: 1px solid #e2e8f0; border-radius: 10px;
      display: flex; align-items: center; justify-content: center; flex: 0 0 54px; overflow: hidden; background: #fff;
    }
    .logo-box img { max-width: 46px; max-height: 46px; object-fit: contain; }
    .logo-box img + svg { display: none; }
    .company { font-weight: 700; font-size: 14px; line-height: 1.35; }
    .muted { font-size: 12px; color: #334155; line-height: 1.4; }
    .doc-id { text-align: right; flex: 0 0 auto; }
    .doc-title { font-weight: 700; font-size: 16px; }
    .doc-sub { font-size: 11px; color: #64748b; text-transform: uppercase; letter-spacing: 0.02em; }
    .doc-no { margin-top: 4px; font-weight: 700; font-size: 14px; }
    .doc-date { font-size: 12.5px; }
    .void-badge {
      display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 999px;
      background: #fee2e2; color: #b91c1c; font-size: 11px; font-weight: 700;
    }
    .customer-bar {
      background: #f8fafc; border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0;
      padding: 8px 12px; margin: 12px 0; font-size: 13px;
    }
    table.lines { width: 100%; border-collapse: collapse; }
    table.lines th, table.lines td { padding: 7px 6px; font-size: 12.5px; vertical-align: top; }
    table.lines th { border-bottom: 1px solid #cbd5e1; font-weight: 700; }
    table.lines td { border-bottom: 1px solid #f1f5f9; }
    .c-idx { width: 36px; } .c-qty, .c-uom { width: 65px; } .c-price { width: 95px; } .c-amount { width: 100px; }
    .idx { text-align: left; } .right { text-align: right; white-space: nowrap; } .center { text-align: center; }
    .amount { font-weight: 700; }
    td.center.muted { color: #64748b; text-align: center; }
    .sheet-foot {
      margin-top: auto; padding-top: 14px; border-top: 1px solid #e2e8f0;
      display: flex; justify-content: space-between; align-items: flex-start; gap: 16px;
    }
    .qty-line { font-size: 12.5px; font-weight: 700; }
    .baht { margin-top: 8px; font-size: 13px; font-weight: 700; }
    .summary-card { width: 270px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px 14px; font-size: 12.5px; }
    .sum-row { display: flex; justify-content: space-between; gap: 12px; margin-top: 3px; }
    .sum-row span:last-child { white-space: nowrap; font-variant-numeric: tabular-nums; }
    .sum-row.grand { border-top: 1px solid #cbd5e1; margin-top: 6px; padding-top: 6px; font-weight: 700; font-size: 13.5px; }
  </style>
</head>
<body>${body}</body>
</html>`;
}
