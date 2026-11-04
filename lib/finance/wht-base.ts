/** WHT base is the amount before VAT (กรมสรรพากร ท.ป. 4/2528), never grand_total. */

export const SALES_WHT_RATE_OPTIONS = [0, 1, 2, 3, 5] as const;

export type SalesWhtRate = (typeof SALES_WHT_RATE_OPTIONS)[number];

export function roundWhtMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function salesWhtBase(input: {
  payAmount: number;
  remainingGrand: number;
  grandTotal: number;
  netBeforeVat: number;
  depositNetDeducted?: number;
  depositDeducted?: number;
  paidAmount?: number;
  vatRate?: number;
}): number {
  const pay = roundWhtMoney(input.payAmount);
  const remaining = roundWhtMoney(input.remainingGrand);
  const fullBase = roundWhtMoney(
    Math.max(0, input.netBeforeVat - (input.depositNetDeducted ?? 0)),
  );
  if (pay <= 0) return 0;

  const settlingRemainder = remaining > 0 && pay + 0.05 >= remaining;
  const priorPaid = roundWhtMoney(input.paidAmount ?? 0);
  if (settlingRemainder && priorPaid <= 0.05) return fullBase;

  const gross = roundWhtMoney(input.grandTotal);
  const depositGross = roundWhtMoney(input.depositDeducted ?? 0);
  const original = roundWhtMoney(Math.max(0, gross - depositGross));
  const denominator = original > 0 ? original : gross;
  if (denominator > 0 && fullBase > 0) {
    return roundWhtMoney(Math.min(fullBase, (pay * fullBase) / denominator));
  }

  const vatRate = input.vatRate && input.vatRate > 0 ? input.vatRate : 7;
  return roundWhtMoney(pay / (1 + vatRate / 100));
}

export function salesWhtAmount(base: number, ratePercent: number): number {
  const rate = Number(ratePercent);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return roundWhtMoney(base * (rate / 100));
}
