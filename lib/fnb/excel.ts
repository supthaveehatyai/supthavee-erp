import * as XLSX from "xlsx";
import type { FnbExcelPriceRow, FnbPosImportPreview } from "@/types/fnb";

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

export function parseLuckyCupPriceWorkbook(
  buffer: ArrayBuffer,
  knownCodes: Set<string>,
): FnbExcelPriceRow[] {
  const found = new Map<string, FnbExcelPriceRow>();
  for (const rows of sheets(buffer)) {
    const headerAt = rows.findIndex((row) => headerIndex(row, ["编码", "物料", "code", "รหัส", "sku"]) >= 0);
    if (headerAt < 0) continue;
    const header = rows[headerAt];
    const codeAt = headerIndex(header, ["编码", "物料编码", "code", "รหัส", "sku", "x"]);
    const nameAt = headerIndex(header, ["名称", "品名", "name", "ชื่อ"]);
    const priceAt = headerIndex(header, ["单价", "价格", "price", "ราคา", "金额"]);
    if (codeAt < 0 || priceAt < 0) continue;
    for (const row of rows.slice(headerAt + 1)) {
      const code = cellText(row[codeAt]).replace(/\s+/g, "");
      if (!/^x/i.test(code) && !/^[a-z0-9-]{2,}$/i.test(code)) continue;
      const price = cellNumber(row[priceAt]);
      if (price <= 0) continue;
      const external = code.toUpperCase();
      found.set(external, {
        external_code: external,
        name_th: nameAt >= 0 ? cellText(row[nameAt]) || external : external,
        unit_price: price,
        action: knownCodes.has(external) ? "update" : "insert",
      });
    }
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
