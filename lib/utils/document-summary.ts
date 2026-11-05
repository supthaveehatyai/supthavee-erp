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
  /**
   * ยอดมัดจำที่รับมาแล้วแบบรวมภาษี (ก้อนที่ลูกค้าโอน)
   * เช่น 1,500.00 จากใบ DEP_IN แบบ INCLUSIVE
   */
  depositGross?: number | null;
  /** ฐานภาษีของมัดจำที่ถอดไว้แล้ว — ถ้าไม่ส่ง ระบบถอดจาก depositGross */
  depositNet?: number | null;
  /** VAT ของมัดจำที่ถอดไว้แล้ว */
  depositVat?: number | null;
  /**
   * ค่าขนส่งฝากส่งตามจริง — บวกเข้า grand_total หลัง VAT
   * ไม่เข้าฐาน VAT และไม่เข้า net_before_vat (ม.81(1)(ณ))
   */
  shippingFee?: number | null;
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
  /** ยอดมัดจำรวมภาษีที่หักในบิลนี้ */
  deposit_deducted: number;
  /** ฐานภาษีมัดจำที่หัก */
  deposit_net_deducted: number;
  /** VAT มัดจำที่หัก */
  deposit_vat_deducted: number;
  /** ค่าขนส่งที่ไม่คิด VAT */
  shipping_fee: number;
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

export type SalesPayableTotals = {
  goods_subtotal: number;
  discount_amount: number;
  deposit_deducted: number;
  /** สินค้าหลังส่วนลดและหักมัดจำ ทั้งก้อนตามโหมด VAT ของบิล */
  goods_after_deposit: number;
  net_before_vat: number;
  vat_amount: number;
  shipping_fee: number;
  /** ยอดที่ต้องเรียกเก็บ: หลังหักมัดจำ และบวกค่าขนส่งที่ยกเว้น VAT */
  grand_total: number;
};

/**
 * ยอดเรียกเก็บของบิลขายที่หักมัดจำแล้วบวกค่าขนส่งนอก VAT
 * INCLUSIVE: ถอด VAT จากยอดสินค้าที่เหลือหลังหักมัดจำ
 * EXCLUSIVE: VAT 7% คิดจากฐานหลังหักมัดจำ แล้วบวกค่าขนส่งทีหลัง
 */
export function salesPayableTotals(input: {
  goodsSubtotal: number;
  discountAmount?: number | null;
  depositDeducted?: number | null;
  vatType: VatCalculationType;
  vatRate?: number | null;
  shippingFee?: number | null;
}): SalesPayableTotals {
  const goods = round2(Number(input.goodsSubtotal ?? 0));
  const discountRaw = Number(input.discountAmount ?? 0);
  const discount = round2(
    Number.isFinite(discountRaw) ? Math.min(Math.max(0, discountRaw), goods) : 0,
  );
  const depositRaw = Number(input.depositDeducted ?? 0);
  const deposit = round2(Number.isFinite(depositRaw) ? Math.max(0, depositRaw) : 0);
  const shippingRaw = Number(input.shippingFee ?? 0);
  const shipping = round2(Number.isFinite(shippingRaw) ? Math.max(0, shippingRaw) : 0);
  const rateRaw = Number(input.vatRate ?? 7);
  const vatRate = Number.isFinite(rateRaw) && rateRaw >= 0 ? rateRaw : 7;
  const goodsAfter = round2(Math.max(0, goods - discount - deposit));
  const vatType = isVatCalculationType(input.vatType) ? input.vatType : "EXCLUSIVE";

  if (vatType === "NONE" || vatRate === 0) {
    return {
      goods_subtotal: goods,
      discount_amount: discount,
      deposit_deducted: deposit,
      goods_after_deposit: goodsAfter,
      net_before_vat: goodsAfter,
      vat_amount: 0,
      shipping_fee: shipping,
      grand_total: round2(goodsAfter + shipping),
    };
  }

  if (vatType === "EXCLUSIVE") {
    const vat = round2(goodsAfter * (vatRate / 100));
    return {
      goods_subtotal: goods,
      discount_amount: discount,
      deposit_deducted: deposit,
      goods_after_deposit: goodsAfter,
      net_before_vat: goodsAfter,
      vat_amount: vat,
      shipping_fee: shipping,
      grand_total: round2(goodsAfter + vat + shipping),
    };
  }

  const net = round2(goodsAfter / (1 + vatRate / 100));
  const vat = round2(goodsAfter - net);
  return {
    goods_subtotal: goods,
    discount_amount: discount,
    deposit_deducted: deposit,
    goods_after_deposit: goodsAfter,
    net_before_vat: net,
    vat_amount: vat,
    shipping_fee: shipping,
    grand_total: round2(goodsAfter + shipping),
  };
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

  const depositGrossRaw = Number(input.depositGross ?? 0);
  const deposit_deducted =
    Number.isFinite(depositGrossRaw) && depositGrossRaw > 0
      ? round2(depositGrossRaw)
      : 0;
  let deposit_net_deducted = 0;
  let deposit_vat_deducted = 0;

  if (deposit_deducted > 0 && vatType !== "NONE" && vatRate > 0) {
    const givenNet = Number(input.depositNet);
    const givenVat = Number(input.depositVat);
    const givenSum =
      (Number.isFinite(givenNet) ? givenNet : 0) +
      (Number.isFinite(givenVat) ? givenVat : 0);
    if (Number.isFinite(givenNet) && Number.isFinite(givenVat) && givenSum > 0) {
      deposit_vat_deducted = round2(Math.max(0, givenVat));
      deposit_net_deducted = round2(Math.max(0, givenNet));
    } else {
      deposit_vat_deducted = round2(
        deposit_deducted * (vatRate / (100 + vatRate)),
      );
      deposit_net_deducted = round2(deposit_deducted - deposit_vat_deducted);
    }
  } else if (deposit_deducted > 0) {
    deposit_net_deducted = deposit_deducted;
  }

  if (deposit_deducted > 0) {
    if (vatType === "EXCLUSIVE" && vatRate > 0) {
      net_before_vat = round2(net_before_vat - deposit_net_deducted);
      vat_amount = round2(net_before_vat * (vatRate / 100));
      grand_total = round2(net_before_vat + vat_amount);
    } else if (vatType === "INCLUSIVE" && vatRate > 0) {
      net_before_vat = round2(net_before_vat - deposit_net_deducted);
      vat_amount = round2(vat_amount - deposit_vat_deducted);
      grand_total = round2(grand_total - deposit_deducted);
    } else {
      grand_total = round2(grand_total - deposit_deducted);
      net_before_vat = grand_total;
      vat_amount = 0;
    }
  }

  const shippingRaw = Number(input.shippingFee ?? 0);
  const shipping_fee =
    Number.isFinite(shippingRaw) && shippingRaw > 0 ? round2(shippingRaw) : 0;
  if (shipping_fee > 0) {
    grand_total = round2(grand_total + shipping_fee);
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
    deposit_deducted,
    deposit_net_deducted,
    deposit_vat_deducted,
    shipping_fee,
  };
}
