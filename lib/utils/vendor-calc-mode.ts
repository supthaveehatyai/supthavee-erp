/**
 * Vendor invoice rounding.
 * LINE_2DEC is the historical receipt formula: discount each line, round to
 * 2 decimals, then sum. HEADER_2DEC and UNIT_4DEC exist for vendors whose
 * paper total is 0.01–0.05 away from that sum.
 */

import {
  calculateNetCostApportionment,
  roundTo4Decimals,
  type ApportionmentItem,
} from "@/lib/utils/accounting";

export const VENDOR_CALC_MODES = ["LINE_2DEC", "HEADER_2DEC", "UNIT_4DEC"] as const;

export type VendorCalcMode = (typeof VENDOR_CALC_MODES)[number];

export type VendorCalcLineInput = {
  id: string;
  unitPrice: number;
  qty: number;
  discountText?: string | null;
  isFoc?: boolean;
};

export type VendorCalcLineResult = {
  id: string;
  lineTotal: number;
};

export function roundMoney2(value: number): number {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 0;
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

export function normalizeVendorCalcMode(value: unknown): VendorCalcMode {
  const raw = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (raw === "HEADER_2DEC" || raw === "UNIT_4DEC") return raw;
  return "LINE_2DEC";
}

export function vendorCalcModeLabel(mode: VendorCalcMode): string {
  if (mode === "HEADER_2DEC") return "ยอดรวมท้ายบิล";
  if (mode === "UNIT_4DEC") return "ทศนิยม 4 ตำแหน่ง";
  return "รายบรรทัด";
}

function toApportionmentItems(
  lines: VendorCalcLineInput[],
  dropLineDiscount: boolean,
): ApportionmentItem[] {
  return lines.map((line) => ({
    id: line.id,
    unitPrice: Number(line.unitPrice) || 0,
    qty: Math.max(0, Number(line.qty) || 0),
    discountText: dropLineDiscount ? null : line.discountText,
    isFoc: Boolean(line.isFoc),
  }));
}

/** Existing engine, then the same 2-decimal line round the receipt table already uses. */
function lineTotals2Dec(
  lines: VendorCalcLineInput[],
  billDiscountText: string | null | undefined,
  dropLineDiscount = false,
): Map<string, number> {
  const results = calculateNetCostApportionment(
    toApportionmentItems(lines, dropLineDiscount),
    billDiscountText?.trim() || null,
  );
  return new Map(
    results.map((row) => [row.id, row.finalLineTotal === 0 ? 0 : roundMoney2(row.finalLineTotal)]),
  );
}

function parsePercentKeep(text: string | null | undefined): number | null {
  const clean = String(text ?? "")
    .replace(/\s|บาท|B|-/gi, "")
    .trim();
  if (!clean) return null;
  const steps = clean.split("+");
  const percentSteps = steps.length > 1 || clean.includes("%");
  if (!percentSteps) return null;
  let keep = 1;
  for (const step of steps) {
    const match = step.match(/[\d.]+/);
    if (!match) continue;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) continue;
    keep *= 1 - value / 100;
  }
  return keep;
}

function parseFlatAmount(text: string | null | undefined): number | null {
  const clean = String(text ?? "")
    .replace(/\s|บาท|B|-/gi, "")
    .trim();
  if (!clean || clean.includes("%") || clean.includes("+")) return null;
  const match = clean.match(/[\d.]+/);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

/** Same percent printed on every priced line, e.g. a 40% bill discount OCR copied onto each row. */
function sharedLineKeep(lines: VendorCalcLineInput[]): number | null {
  const priced = lines.filter((line) => !line.isFoc && (Number(line.qty) || 0) > 0);
  if (priced.length === 0) return null;
  const keeps = priced.map((line) => parsePercentKeep(line.discountText));
  const first = keeps[0];
  if (first == null) return null;
  if (!keeps.every((keep) => keep != null && Math.abs(keep - first) < 0.0000001)) return null;
  return first;
}

function sumTotals(totals: Map<string, number>, lines: VendorCalcLineInput[]): number {
  return roundMoney2(
    lines.reduce((sum, line) => sum + (line.isFoc ? 0 : totals.get(line.id) ?? 0), 0),
  );
}

function shiftLastLine(
  totals: Map<string, number>,
  lines: VendorCalcLineInput[],
  delta: number,
): Map<string, number> {
  const next = new Map(totals);
  if (Math.abs(delta) < 0.001) return next;
  const last = [...lines].reverse().find((line) => !line.isFoc && (Number(line.qty) || 0) > 0);
  if (!last) return next;
  next.set(last.id, roundMoney2((next.get(last.id) ?? 0) + delta));
  return next;
}

function headerTotals(
  lines: VendorCalcLineInput[],
  billDiscountText: string | null | undefined,
): Map<string, number> {
  const billText = billDiscountText?.trim() || "";
  const sharedKeep = billText ? null : sharedLineKeep(lines);
  const grossLines = sharedKeep == null ? lines : lines.map((line) => ({ ...line, discountText: null }));
  const grossTotals = lineTotals2Dec(grossLines, null, false);
  const gross = sumTotals(grossTotals, grossLines);
  const lineTotals = lineTotals2Dec(lines, billText || null, false);
  const lineSum = sumTotals(lineTotals, lines);

  let target = lineSum;
  const billKeep = parsePercentKeep(billText);
  const keep = billKeep ?? sharedKeep;
  if (keep != null) {
    const discount = roundMoney2(gross * (1 - keep));
    target = roundMoney2(gross - discount);
  } else {
    const flat = parseFlatAmount(billText);
    if (flat != null && flat > 0) {
      target = roundMoney2(Math.max(0, gross - roundMoney2(flat)));
    }
  }

  return shiftLastLine(lineTotals, lines, roundMoney2(target - lineSum));
}

function applyKeep(unitPrice: number, keep: number | null): number {
  if (keep == null) return unitPrice;
  return roundTo4Decimals(unitPrice * keep);
}

function unit4Totals(
  lines: VendorCalcLineInput[],
  billDiscountText: string | null | undefined,
): Map<string, number> {
  const billText = billDiscountText?.trim() || "";
  const billKeep = parsePercentKeep(billText);
  const billFlat = parseFlatAmount(billText);
  const sharedKeep = billText ? null : sharedLineKeep(lines);
  const raw = new Map<string, number>();

  for (const line of lines) {
    if (line.isFoc || (Number(line.qty) || 0) <= 0) {
      raw.set(line.id, 0);
      continue;
    }
    const lineKeep = parsePercentKeep(line.discountText);
    const lineFlat = parseFlatAmount(line.discountText);
    let unit = Number(line.unitPrice) || 0;
    if (sharedKeep != null) {
      unit = applyKeep(unit, sharedKeep);
    } else {
      unit = applyKeep(unit, lineKeep);
      if (lineFlat != null && line.qty > 0) {
        unit = roundTo4Decimals(Math.max(0, unit - lineFlat / line.qty));
      }
    }
    unit = applyKeep(unit, billKeep);
    raw.set(line.id, unit * line.qty);
  }

  const rawSum = lines.reduce((sum, line) => sum + (raw.get(line.id) ?? 0), 0);
  const flat = billFlat ?? 0;
  const target = roundMoney2(Math.max(0, rawSum - flat));
  const rounded = new Map<string, number>();
  for (const line of lines) {
    rounded.set(line.id, line.isFoc ? 0 : roundMoney2(raw.get(line.id) ?? 0));
  }
  const roundedSum = sumTotals(rounded, lines);
  return shiftLastLine(rounded, lines, roundMoney2(target - roundedSum));
}

export function calculateVendorLineTotals(
  lines: VendorCalcLineInput[],
  billDiscountText: string | null | undefined,
  mode: VendorCalcMode,
): VendorCalcLineResult[] {
  const totals =
    mode === "HEADER_2DEC"
      ? headerTotals(lines, billDiscountText)
      : mode === "UNIT_4DEC"
        ? unit4Totals(lines, billDiscountText)
        : lineTotals2Dec(lines, billDiscountText, false);

  return lines.map((line) => ({
    id: line.id,
    lineTotal: line.isFoc ? 0 : (totals.get(line.id) ?? 0),
  }));
}

export function sumVendorLineTotals(results: VendorCalcLineResult[]): number {
  return roundMoney2(results.reduce((sum, line) => sum + line.lineTotal, 0));
}

/** Payable goods amount. EXCLUSIVE adds 7% once at the header. */
export function vendorGoodsGrand(
  goodsNet: number,
  vatType: "NONE" | "INCLUSIVE" | "EXCLUSIVE",
): number {
  const net = roundMoney2(goodsNet);
  if (vatType === "EXCLUSIVE") {
    return roundMoney2(net + roundMoney2(net * 0.07));
  }
  return net;
}

export type VendorCalcQuote = {
  mode: VendorCalcMode;
  goodsNet: number;
  grandTotal: number;
};

export function quoteVendorCalcModes(
  lines: VendorCalcLineInput[],
  billDiscountText: string | null | undefined,
  vatType: "NONE" | "INCLUSIVE" | "EXCLUSIVE",
): VendorCalcQuote[] {
  return VENDOR_CALC_MODES.map((mode) => {
    const goodsNet = sumVendorLineTotals(
      calculateVendorLineTotals(lines, billDiscountText, mode),
    );
    return { mode, goodsNet, grandTotal: vendorGoodsGrand(goodsNet, vatType) };
  });
}

export function vendorCalcSpread(quotes: VendorCalcQuote[]): number {
  if (quotes.length === 0) return 0;
  const grands = quotes.map((quote) => quote.grandTotal);
  return roundMoney2(Math.max(...grands) - Math.min(...grands));
}

function paperAmount(value: number | null | undefined): number | null {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return roundMoney2(amount);
}

function quoteMatchesPaper(
  quote: VendorCalcQuote,
  paperSubtotal: number | null,
  paperGrand: number | null,
  freight: number,
): boolean {
  if (paperSubtotal != null && Math.abs(quote.goodsNet - paperSubtotal) < 0.001) return true;
  if (paperGrand == null) return false;
  if (Math.abs(quote.grandTotal - paperGrand) < 0.001) return true;
  return Math.abs(roundMoney2(quote.grandTotal + freight) - paperGrand) < 0.001;
}

/**
 * Keep the current mode when it already matches the paper.
 * Otherwise switch to the first other mode that matches. LINE_2DEC stays
 * when nothing on the paper matches.
 */
export function matchVendorCalcMode(input: {
  preferred: VendorCalcMode;
  quotes: VendorCalcQuote[];
  paperSubtotal?: number | null;
  paperGrand?: number | null;
  freight?: number | null;
}): VendorCalcMode {
  const paperSubtotal = paperAmount(input.paperSubtotal);
  const paperGrand = paperAmount(input.paperGrand);
  if (paperSubtotal == null && paperGrand == null) return input.preferred;
  const freight = roundMoney2(Math.max(0, Number(input.freight) || 0));
  const preferred = input.quotes.find((quote) => quote.mode === input.preferred);
  if (preferred && quoteMatchesPaper(preferred, paperSubtotal, paperGrand, freight)) {
    return input.preferred;
  }
  const matched = input.quotes.find((quote) =>
    quoteMatchesPaper(quote, paperSubtotal, paperGrand, freight),
  );
  return matched?.mode ?? input.preferred;
}
