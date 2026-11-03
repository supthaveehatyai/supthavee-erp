export type GoodsQtyLine = {
  is_service_item?: boolean | null;
  is_service?: boolean | null;
  product_id?: string | null;
  sku?: string | null;
  qty?: number | string | null;
  uom_used?: string | null;
};

export type GoodsQtyBucket = {
  uom: string;
  qty: number;
};

export type GoodsQtySummary = {
  lineCount: number;
  buckets: GoodsQtyBucket[];
  label: string;
};

function isGoodsLine(row: GoodsQtyLine): boolean {
  if (row.is_service_item || row.is_service) return false;
  if (!row.product_id) return false;
  if (String(row.sku ?? "").startsWith("SVC")) return false;
  return true;
}

function formatQty(value: number): string {
  const qty = Math.round(value * 100) / 100;
  if (Number.isInteger(qty)) return qty.toLocaleString("th-TH");
  return qty.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** รวมจำนวนสินค้าจริง แยกตามหน่วยนับ และไม่นับงานบริการ */
export function summarizeGoodsQty(rows: GoodsQtyLine[]): GoodsQtySummary {
  const grouped = new Map<string, number>();
  let lineCount = 0;

  for (const row of rows) {
    if (!isGoodsLine(row)) continue;
    const qty = Number(row.qty ?? 0);
    if (!Number.isFinite(qty) || qty === 0) continue;
    const uom = String(row.uom_used ?? "").trim() || "หน่วย";
    grouped.set(uom, (grouped.get(uom) ?? 0) + qty);
    lineCount += 1;
  }

  const buckets = [...grouped.entries()]
    .map(([uom, qty]) => ({ uom, qty: Math.round(qty * 100) / 100 }))
    .filter((bucket) => bucket.qty !== 0)
    .sort((a, b) => b.qty - a.qty || a.uom.localeCompare(b.uom, "th"));

  if (buckets.length === 0) {
    return { lineCount: 0, buckets: [], label: "" };
  }

  const qtyText = buckets
    .map((bucket) => `${formatQty(bucket.qty)} ${bucket.uom}`)
    .join(" · ");
  const label =
    buckets.length === 1
      ? `📦 รวมจำนวนสินค้า: ${qtyText} (${lineCount.toLocaleString("th-TH")} รายการ · ไม่รวมงานบริการ)`
      : `📦 รวมจำนวนสินค้า: ${qtyText} (ไม่รวมงานบริการ)`;

  return { lineCount, buckets, label };
}
