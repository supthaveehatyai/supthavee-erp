import * as XLSX from "xlsx";
import type { FnbExcelPriceRow, FnbPosImportPreview, FnbVendorSheetPreview, FnbVendorSheetRow } from "@/types/fnb";

function cellText(value: unknown): string {
  return String(value ?? "").trim();
}

function cellNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const cleaned = cellText(value).replace(/,/g, "");
  const amount = Number(cleaned);
  return Number.isFinite(amount) ? amount : 0;
}

function sheets(buffer: ArrayBuffer): unknown[][][] {
  const book = XLSX.read(buffer, { type: "array" });
  return book.SheetNames.map((name) => XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true }) as unknown[][]);
}

function headerIndex(header: unknown[], needles: string[]): number {
  return header.findIndex((cell) => {
    const text = cellText(cell).toLowerCase();
    return needles.some((needle) => text.includes(needle.toLowerCase()));
  });
}

function detectBranch(blob: string): string | null {
  const text = blob.toUpperCase().replace(/\s+/g, "");
  if (text.includes("LUCUKY-PSU") || text.includes("LUCKY-PSU") || text.includes("LC-PSU") || text.includes("ทุ่งรี")) return "LC-PSU";
  if (text.includes("LC-HDY") || text.includes("LUCKY-HDY") || text.includes("เพชรเกษม")) return "LC-HDY";
  if (text.includes("CT-KLN") || text.includes("คลองแงะ")) return "CT-KLN";
  if (text.includes("CT-BNP") || text.includes("บ้านพรุ")) return "CT-BNP";
  if (text.includes("CT-NMM") || text.includes("นาหม่อม")) return "CT-NMM";
  return null;
}

function isHeaderRow(row: unknown[]): boolean {
  const joined = row.map(cellText).join(" ");
  return joined.includes("物料编码") || joined.includes("物料名称") || joined.includes("ชื่อผลิตภัณฑ์");
}

export function parseVendorCatalogSheet(buffer: ArrayBuffer): FnbVendorSheetPreview {
  const book = XLSX.read(buffer, { type: "array" });
  const rows: FnbVendorSheetRow[] = [];
  let branch: string | null = null;
  for (const name of book.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: true }) as unknown[][];
    branch = branch ?? detectBranch(`${name} ${grid.slice(0, 12).flat().map(cellText).join(" ")}`);
    const headerAt = grid.findIndex(isHeaderRow);
    if (headerAt < 0) continue;
    const header = grid[headerAt];
    const codeAt = headerIndex(header, ["物料编码", "รหัส", "code", "sku"]);
    const nameAt = headerIndex(header, ["物料名称", "ชื่อผลิตภัณฑ์", "名称", "品名", "name"]);
    const qtyAt = headerIndex(header, ["数量", "จำนวน", "qty"]);
    const unitAt = headerIndex(header, ["单位", "หน่วย", "uom"]);
    const priceAt = headerIndex(header, ["单价", "ราคา", "价格", "price"]);
    for (const row of grid.slice(headerAt + 1)) {
      const first = cellText(row[0] ?? row[codeAt] ?? "");
      if (first.includes("总计") || first.includes("รวมทั้งสิ้น")) break;
      const rawCode = codeAt >= 0 ? cellText(row[codeAt]) : "";
      const rawDesc = nameAt >= 0 ? cellText(row[nameAt]) : "";
      if (!rawCode && !rawDesc) continue;
      const external = rawCode.replace(/\s+/g, "").toUpperCase();
      rows.push({
        raw_code: rawCode,
        raw_desc: rawDesc || external,
        received_qty: qtyAt >= 0 ? cellNumber(row[qtyAt]) : 0,
        received_uom: unitAt >= 0 ? cellText(row[unitAt]) : "",
        unit_price: priceAt >= 0 ? cellNumber(row[priceAt]) : 0,
        external_code: external,
        item_id: null,
        item_name: null,
      });
    }
  }
  return { branch_code: branch, rows };
}

export function parseLuckyCupPriceWorkbook(
  buffer: ArrayBuffer,
  knownCodes: Set<string>,
): FnbExcelPriceRow[] {
  const found = new Map<string, FnbExcelPriceRow>();
  for (const row of parseVendorCatalogSheet(buffer).rows) {
    if (!row.external_code || row.unit_price <= 0) continue;
    found.set(row.external_code, {
      external_code: row.external_code,
      name_th: row.raw_desc || row.external_code,
      unit_price: row.unit_price,
      action: knownCodes.has(row.external_code) ? "update" : "insert",
    });
  }
  return [...found.values()];
}

export function parseLuckyCupPosWorkbook(buffer: ArrayBuffer, fileName: string): FnbPosImportPreview {
  const cancelled: unknown[] = [];
  let valid = 0;
  let gross = 0;
  let net = 0;
  for (const rows of sheets(buffer)) {
    const headerAt = rows.findIndex((row) => headerIndex(row, ["商品id", "商品名称"]) >= 0);
    if (headerAt < 0) continue;
    const header = rows[headerAt];
    const idAt = headerIndex(header, ["商品id"]);
    const nameAt = headerIndex(header, ["商品名称"]);
    const typeAt = headerIndex(header, ["单据", "类型", "状态", "type"]);
    const amountAt = headerIndex(header, ["实收", "金额", "销售额", "amount"]);
    for (const row of rows.slice(headerAt + 1)) {
      const rawId = idAt >= 0 ? cellText(row[idAt]) : "";
      const rawName = nameAt >= 0 ? cellText(row[nameAt]) : "";
      if (!rawId && !rawName) continue;
      const kind = typeAt >= 0 ? cellText(row[typeAt]) : "销货单";
      const amount = amountAt >= 0 ? cellNumber(row[amountAt]) : 0;
      const sku = rawId.split("_")[0] || rawId;
      const menuName = (rawName.split("_")[0] || rawName).trim();
      const entry = { sku, menuName, kind, amount };
      if (kind.includes("已退单") || kind.includes("退货")) {
        cancelled.push(entry);
        continue;
      }
      if (kind && !kind.includes("销货")) continue;
      valid += 1;
      gross += amount;
      net += amount;
    }
  }
  return {
    file_name: fileName,
    valid_order_count: valid,
    cancelled_order_count: cancelled.length,
    gross_sales_total: gross,
    net_sales_total: net,
    cancelled_orders_json: cancelled,
  };
}
