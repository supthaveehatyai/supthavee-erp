import ExcelJS from "exceljs";
import type { EcommerceChannel } from "@/types/sales-ocr";
import { normalizeIsoDate } from "@/lib/sales/sales-ocr-parse";

export type SheetOrderLine = {
  description: string;
  sku: string;
  qty: number;
  uom: string;
  unit_price: number;
  discount_text: string;
};

export type SheetOrder = {
  sales_channel: EcommerceChannel;
  ecommerce_order_no: string;
  ecommerce_buyer_name: string | null;
  tracking_no: string | null;
  doc_date: string | null;
  items: SheetOrderLine[];
};

const HEADER_ALIASES: Record<string, string[]> = {
  order: [
    "หมายเลขคำสั่งซื้อ",
    "เลขคำสั่งซื้อ",
    "order id",
    "order sn",
    "ordersn",
    "order number",
    "ordernumber",
    "order no",
  ],
  buyer: [
    "ชื่อผู้ใช้ (ผู้ซื้อ)",
    "ชื่อผู้ซื้อ",
    "ผู้ซื้อ",
    "buyer username",
    "buyer",
    "customer name",
    "ชื่อผู้รับ",
  ],
  date: [
    "วันที่ทำการสั่งซื้อ",
    "วันที่สั่งซื้อ",
    "order creation date",
    "order date",
    "createdat",
    "create time",
  ],
  tracking: [
    "เลขติดตามพัสดุ",
    "หมายเลขพัสดุ",
    "*เลขพัสดุ",
    "tracking number",
    "tracking no",
    "trackingcode",
  ],
  item: ["ชื่อสินค้า", "product name", "item name", "สินค้า"],
  qty: ["จำนวน", "qty", "quantity"],
  price: [
    "ราคาขาย",
    "ราคาขายสุทธิ",
    "ราคาสุทธิ",
    "paid price",
    "unit price",
    "deal price",
    "ราคา",
  ],
  sku: ["เลขอ้างอิง sku", "seller sku", "sku", "รหัสสินค้า", "sku reference no"],
};

function headerKey(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("th").replace(/\s+/g, " ").trim();
}

function pickColumn(headers: string[], aliases: string[]): number {
  const normalized = headers.map(headerKey);
  for (const alias of aliases) {
    const key = headerKey(alias);
    const index = normalized.findIndex((header) => header === key || header.includes(key));
    if (index >= 0) return index;
  }
  return -1;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "object") {
    if ("text" in value && value.text != null) return String(value.text).trim();
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("").trim();
    }
  }
  return String(value).trim();
}

function detectChannel(fileName: string, headers: string[]): EcommerceChannel | null {
  const blob = `${fileName} ${headers.join(" ")}`.toLocaleLowerCase("en");
  if (blob.includes("lazada") || blob.includes("laz")) return "LAZADA";
  if (blob.includes("shopee") || headers.some((header) => header.includes("หมายเลขคำสั่งซื้อ"))) {
    return "SHOPEE";
  }
  return null;
}

function parseNumber(value: string): number {
  const parsed = Number(value.replace(/,/g, "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function detectChannelFromName(fileName: string): EcommerceChannel | null {
  const name = fileName.toLocaleLowerCase("en");
  if (name.includes("lazada") || name.includes("laz")) return "LAZADA";
  if (name.includes("shopee") || name.includes("sp")) return "SHOPEE";
  return null;
}

export async function parseEcommerceSpreadsheet(
  file: File,
): Promise<{ channel: EcommerceChannel | null; orders: SheetOrder[]; error: string | null }> {
  const name = file.name || "";
  const lower = name.toLocaleLowerCase("en");
  if (lower.endsWith(".csv")) {
    const text = await file.text();
    return parseDelimited(text, name);
  }

  const workbook = new ExcelJS.Workbook();
  const buffer = Buffer.from(await file.arrayBuffer());
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { channel: null, orders: [], error: "ไม่พบแผ่นงานในไฟล์ Excel" };

  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const values = Array.isArray(row.values) ? row.values.slice(1) : [];
    rows.push(values.map((value) => cellText(value as ExcelJS.CellValue)));
  });
  return rowsToOrders(rows, name);
}

function parseDelimited(
  text: string,
  fileName: string,
): { channel: EcommerceChannel | null; orders: SheetOrder[]; error: string | null } {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) {
    return { channel: null, orders: [], error: "ไฟล์ CSV ไม่มีรายการ" };
  }
  const delimiter = lines[0].includes("\t") ? "\t" : ",";
  const rows = lines.map((line) => splitCsvLine(line, delimiter));
  return rowsToOrders(rows, fileName);
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

function rowsToOrders(
  rows: string[][],
  fileName: string,
): { channel: EcommerceChannel | null; orders: SheetOrder[]; error: string | null } {
  const headerIndex = rows.findIndex((row) =>
    row.some((cell) => {
      const key = headerKey(cell);
      return HEADER_ALIASES.order.some((alias) => key.includes(headerKey(alias)));
    }),
  );
  if (headerIndex < 0) {
    return {
      channel: detectChannelFromName(fileName),
      orders: [],
      error: "ไม่พบคอลัมน์เลขคำสั่งซื้อในไฟล์",
    };
  }

  const headers = rows[headerIndex];
  const channel = detectChannel(fileName, headers);
  const orderCol = pickColumn(headers, HEADER_ALIASES.order);
  const buyerCol = pickColumn(headers, HEADER_ALIASES.buyer);
  const dateCol = pickColumn(headers, HEADER_ALIASES.date);
  const trackingCol = pickColumn(headers, HEADER_ALIASES.tracking);
  const itemCol = pickColumn(headers, HEADER_ALIASES.item);
  const qtyCol = pickColumn(headers, HEADER_ALIASES.qty);
  const priceCol = pickColumn(headers, HEADER_ALIASES.price);
  const skuCol = pickColumn(headers, HEADER_ALIASES.sku);

  const grouped = new Map<string, SheetOrder>();
  for (const row of rows.slice(headerIndex + 1)) {
    const orderNo = (row[orderCol] ?? "").trim();
    if (!orderNo) continue;
    const existing = grouped.get(orderNo) ?? {
      sales_channel: channel ?? "SHOPEE",
      ecommerce_order_no: orderNo,
      ecommerce_buyer_name: buyerCol >= 0 ? row[buyerCol]?.trim() || null : null,
      tracking_no: trackingCol >= 0 ? row[trackingCol]?.trim() || null : null,
      doc_date: dateCol >= 0 ? normalizeIsoDate(row[dateCol] ?? "") : null,
      items: [],
    };
    if (!existing.ecommerce_buyer_name && buyerCol >= 0) {
      existing.ecommerce_buyer_name = row[buyerCol]?.trim() || null;
    }
    if (!existing.tracking_no && trackingCol >= 0) {
      existing.tracking_no = row[trackingCol]?.trim() || null;
    }
    if (!existing.doc_date && dateCol >= 0) {
      existing.doc_date = normalizeIsoDate(row[dateCol] ?? "");
    }
    const description = itemCol >= 0 ? row[itemCol]?.trim() || "" : "";
    const sku = skuCol >= 0 ? row[skuCol]?.trim() || "" : "";
    if (description || sku) {
      existing.items.push({
        description: description || sku,
        sku,
        qty: qtyCol >= 0 ? parseNumber(row[qtyCol] ?? "") || 1 : 1,
        uom: "ตัว",
        unit_price: priceCol >= 0 ? parseNumber(row[priceCol] ?? "") : 0,
        discount_text: "",
      });
    }
    grouped.set(orderNo, existing);
  }

  return { channel, orders: [...grouped.values()], error: null };
}
