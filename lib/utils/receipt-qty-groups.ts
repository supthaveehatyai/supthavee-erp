import { resolveConversionFactor, stockBaseQty } from "@/lib/utils/purchase-uom";

export type ReceiptQtyLine = {
  qty: number;
  conversionFactor: number;
  purchaseUomCode?: string | null;
  purchaseUomName?: string | null;
  baseUom?: string | null;
  size?: string | null;
  /** null/undefined = unknown, then size `00` + kilogram decides. */
  isRawMaterial?: boolean | null;
  exVatAmount: number;
  freightShare: number;
};

export type UnitQtyBucket = {
  label: string;
  shortLabel: string;
  qty: number;
  exVat: number;
  freight: number;
};

export type ReceiptCostGroup = {
  qtyLabel: string;
  exVat: number;
  goodsAverage: string;
};

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function unitFamily(value: string | null | undefined): string {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");
  if (!raw) return "";
  if (raw === "kgs" || raw === "kg" || raw === "กก" || raw === "กิโล" || raw === "กิโลกรัม") {
    return "kgs";
  }
  if (raw === "pcs" || raw === "ตัว" || raw === "ชิ้น") return "pcs";
  if (raw === "cup" || raw === "ใบ") return "cup";
  if (raw === "mdl" || raw === "เหรียญ") return "mdl";
  if (raw === "plt" || raw === "แผ่น" || raw === "ป้าย") return "plt";
  if (raw === "unt" || raw === "อัน") return "unt";
  if (raw === "dzn" || raw === "โหล") return "dzn";
  if (raw === "คู่" || raw === "prs" || raw === "pair") return "pair";
  return raw;
}

export function displayUnitName(value: string | null | undefined): string {
  const family = unitFamily(value);
  if (family === "kgs") return "กิโลกรัม";
  if (family === "pcs") return "ตัว";
  if (family === "cup") return "ใบ";
  if (family === "mdl") return "เหรียญ";
  if (family === "plt") return "แผ่น";
  if (family === "unt") return "อัน";
  if (family === "dzn") return "โหล";
  if (family === "pair") return "คู่";
  const trimmed = String(value ?? "").trim();
  return trimmed;
}

function shortUnitName(label: string): string {
  return label === "กิโลกรัม" ? "กก." : label;
}

function isKilogram(line: ReceiptQtyLine): boolean {
  return (
    unitFamily(line.baseUom) === "kgs" ||
    unitFamily(line.purchaseUomName) === "kgs" ||
    unitFamily(line.purchaseUomCode) === "kgs"
  );
}

/** Finished goods stay separate from raw materials and size-00 kilogram packaging. */
export function isRawReceiptLine(line: ReceiptQtyLine): boolean {
  if (line.isRawMaterial === true) return true;
  return String(line.size ?? "").trim() === "00" && isKilogram(line);
}

export function receiptBaseUnitLabel(line: ReceiptQtyLine): string {
  const base = displayUnitName(line.baseUom);
  if (base) return base;
  const purchase = displayUnitName(line.purchaseUomName) || displayUnitName(line.purchaseUomCode);
  return purchase || "หน่วย";
}

function formatQty(qty: number): string {
  return qty.toLocaleString("th-TH", { maximumFractionDigits: 4 });
}

export function formatUnitQtyList(
  buckets: UnitQtyBucket[],
  separator: " + " | " • ",
  compact: boolean,
): string {
  if (buckets.length === 0) return "0";
  return buckets
    .map((bucket) => `${formatQty(bucket.qty)} ${compact ? bucket.shortLabel : bucket.label}`)
    .join(separator);
}

function averageCaption(
  buckets: UnitQtyBucket[],
  formatMoney: (value: number) => string,
  includeFreight: boolean,
  prefix: string,
): string {
  const parts = buckets
    .filter((bucket) => bucket.qty > 0.00005)
    .map((bucket) => {
      const amount = includeFreight ? bucket.exVat + bucket.freight : bucket.exVat;
      const average = amount / bucket.qty;
      return `฿${formatMoney(average)} / ${bucket.label}`;
    });
  if (parts.length === 0) return "";
  return `${prefix}${parts.join(" • ")}`;
}

function bucketsFrom(
  lines: ReceiptQtyLine[],
  predicate: (line: ReceiptQtyLine) => boolean,
): UnitQtyBucket[] {
  const order: string[] = [];
  const byLabel = new Map<string, UnitQtyBucket>();
  for (const line of lines) {
    if (!predicate(line)) continue;
    const label = receiptBaseUnitLabel(line);
    const qty = stockBaseQty(Number(line.qty) || 0, resolveConversionFactor(line.conversionFactor));
    const existing = byLabel.get(label);
    if (existing) {
      existing.qty += qty;
      existing.exVat += Number(line.exVatAmount) || 0;
      existing.freight += Number(line.freightShare) || 0;
      continue;
    }
    order.push(label);
    byLabel.set(label, {
      label,
      shortLabel: shortUnitName(label),
      qty,
      exVat: Number(line.exVatAmount) || 0,
      freight: Number(line.freightShare) || 0,
    });
  }
  return order
    .map((label) => byLabel.get(label))
    .filter((bucket): bucket is UnitQtyBucket => Boolean(bucket && bucket.qty > 0.00005));
}

function asGroup(
  buckets: UnitQtyBucket[],
  formatMoney: (value: number) => string,
): ReceiptCostGroup | null {
  if (buckets.length === 0) return null;
  return {
    qtyLabel: formatUnitQtyList(buckets, " + ", false),
    exVat: round2(buckets.reduce((sum, bucket) => sum + bucket.exVat, 0)),
    goodsAverage: averageCaption(buckets, formatMoney, false, "เฉลี่ย "),
  };
}

export function buildReceiptQtySummary(
  lines: ReceiptQtyLine[],
  formatMoney: (value: number) => string,
  goodsExVatTotal?: number,
): {
  receivedQtyLabel: string;
  receivedQtyCompact: string;
  finished: ReceiptCostGroup | null;
  raw: ReceiptCostGroup | null;
  poolAverage: string | null;
} {
  const finishedBuckets = bucketsFrom(lines, (line) => !isRawReceiptLine(line));
  const rawBuckets = bucketsFrom(lines, (line) => isRawReceiptLine(line));
  const finished = asGroup(finishedBuckets, formatMoney);
  const raw = asGroup(rawBuckets, formatMoney);

  if (goodsExVatTotal != null && (finished || raw)) {
    const drift = round2(goodsExVatTotal - (finished?.exVat ?? 0) - (raw?.exVat ?? 0));
    if (Math.abs(drift) >= 0.01 && Math.abs(drift) <= 0.05) {
      if (finished && (!raw || finished.exVat >= raw.exVat)) finished.exVat = round2(finished.exVat + drift);
      else if (raw) raw.exVat = round2(raw.exVat + drift);
    }
  }

  const all = [...finishedBuckets, ...rawBuckets];
  const poolSource = finishedBuckets.length > 0 ? finishedBuckets : rawBuckets;
  const poolPrefix = finishedBuckets.length > 0 ? "เฉลี่ยสินค้าหลัก " : "เฉลี่ยวัตถุดิบ ";

  return {
    receivedQtyLabel: formatUnitQtyList(all, " + ", false),
    receivedQtyCompact: formatUnitQtyList(all, " • ", true),
    finished,
    raw,
    poolAverage: poolSource.length > 0 ? averageCaption(poolSource, formatMoney, true, poolPrefix) : null,
  };
}
