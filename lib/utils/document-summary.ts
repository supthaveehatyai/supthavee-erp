/**
 * Document bill summary — Subtotal / Bill Discount / VAT / Grand Total.
 * Pure functions (no I/O) for real-time UI + server-side recompute.
 */

export const VAT_CALCULATION_TYPES = [
  "NONE",
  "INCLUSIVE",
  "EXCLUSIVE",
] as const;

export type VatCalculationType = (typeof VAT_CALCULATION_TYPES)[number];

export type DocumentSummaryInput = {
  /** Line totals (qty × unit_price) already computed. */
  lineTotals: number[];
  /**
   * Inbound freight (ค่าขนส่งต้นทาง) — added to total_amount before bill
   * discount / VAT (follows the same vat_type as line prices).
   */
  freightCost?: number | null;
  /** Bill discount text — "10%", "500", "10" (baht if no %). */
  discountText?: string | null;
  vatType: VatCalculationType;
  /** Percent, default 7. */
  vatRate?: number;
};

export type DocumentSummaryResult = {
  /** Σ line totals — ยอดรวมสินค้า */
  total_amount: number;
  /** Bill discount amount — จำนวนเงินส่วนลดท้ายบิล */
  discount_amount: number;
  /** ยอดหลังหักส่วนลด (ก่อนแยก/บวก VAT ตามโหมด) */
  net_after_discount: number;
  /**
   * ยอดก่อน VAT:
   * - EXCLUSIVE / NONE → เท่ากับ net_after_discount
   * - INCLUSIVE → net_after_discount หัก VAT ออกแล้ว
   */
  net_before_vat: number;
  vat_amount: number;
  grand_total: number;
  vat_rate: number;
  vat_type: VatCalculationType;
};

function round2(value: number): number {
  return Math.round(Math.max(0, value) * 100) / 100;
}

/**
 * Parse bill discount text into a baht amount against `base`.
 * Supports "10%" or flat "500" / "500 บาท".
 */
export function parseBillDiscountAmount(
  base: number,
  discountText: string | null | undefined,
): number {
  if (!discountText || !Number.isFinite(base) || base <= 0) return 0;

  const clean = discountText.replace(/\s|บาท|B|-/gi, "").trim();
  if (!clean) return 0;

  const match = clean.match(/[\d.]+/);
  if (!match) return 0;

  const val = Number.parseFloat(match[0]);
  if (!Number.isFinite(val) || val < 0) return 0;

  if (clean.includes("%")) {
    return round2(base * (val / 100));
  }
  return round2(Math.min(val, base));
}

export function isVatCalculationType(
  value: string,
): value is VatCalculationType {
  return (VAT_CALCULATION_TYPES as readonly string[]).includes(value);
}

/**
 * Real-time document money summary.
 *
 * EXCLUSIVE: prices exclude VAT → VAT = net × rate%, Grand = net + VAT
 * INCLUSIVE: prices include VAT → extract VAT from net, Grand = net
 * NONE: no VAT → Grand = net
 */
export function calculateDocumentSummary(
  input: DocumentSummaryInput,
): DocumentSummaryResult {
  const vatType = isVatCalculationType(input.vatType)
    ? input.vatType
    : "EXCLUSIVE";
  const vatRateRaw = Number(input.vatRate ?? 7);
  const vatRate =
    Number.isFinite(vatRateRaw) && vatRateRaw >= 0 ? vatRateRaw : 7;

  const lineSum = (input.lineTotals ?? []).reduce(
    (sum, value) => sum + (Number.isFinite(value) ? value : 0),
    0,
  );
  const freightRaw = Number(input.freightCost ?? 0);
  const freightAmount =
    Number.isFinite(freightRaw) && freightRaw > 0 ? freightRaw : 0;

  const total_amount = round2(lineSum + freightAmount);

  const discount_amount = parseBillDiscountAmount(
    total_amount,
    input.discountText,
  );
  const net_after_discount = round2(total_amount - discount_amount);

  let net_before_vat = net_after_discount;
  let vat_amount = 0;
  let grand_total = net_after_discount;

  if (vatType === "NONE" || vatRate === 0 || net_after_discount === 0) {
    net_before_vat = net_after_discount;
    vat_amount = 0;
    grand_total = net_after_discount;
  } else if (vatType === "EXCLUSIVE") {
    net_before_vat = net_after_discount;
    vat_amount = round2(net_before_vat * (vatRate / 100));
    grand_total = round2(net_before_vat + vat_amount);
  } else {
    // INCLUSIVE — net_after_discount already includes VAT
    grand_total = net_after_discount;
    vat_amount = round2(grand_total * (vatRate / (100 + vatRate)));
    net_before_vat = round2(grand_total - vat_amount);
  }

  return {
    total_amount,
    discount_amount,
    net_after_discount,
    net_before_vat,
    vat_amount,
    grand_total,
    vat_rate: vatRate,
    vat_type: vatType,
  };
}
