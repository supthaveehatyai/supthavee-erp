export function isFullLineDiscount(discountText: string | null | undefined): boolean {
  return (discountText ?? "").trim() === "100%";
}

export function moneyAfterQtyPrice(input: {
  qty: number;
  unitPrice: number;
  discountText: string;
  discountAmount: number;
}): { discount_amount: number; line_total: number } {
  const gross =
    Math.round(Math.max(0, input.qty * input.unitPrice) * 100) / 100;
  if (isFullLineDiscount(input.discountText)) {
    return { discount_amount: gross, line_total: 0 };
  }
  return { discount_amount: input.discountAmount, line_total: gross };
}
