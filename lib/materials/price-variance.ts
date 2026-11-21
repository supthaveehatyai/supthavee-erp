export function purchasePriceVariance(
  referencePrice: number,
  actualUnitPrice: number,
): { amount: number; percent: number } | null {
  const reference = Number(referencePrice);
  const actual = Number(actualUnitPrice);
  if (!Number.isFinite(reference) || reference <= 0) return null;
  if (!Number.isFinite(actual) || actual <= reference) return null;
  const amount = Math.round((actual - reference) * 100) / 100;
  const percent = (amount / reference) * 100;
  if (percent <= 1) return null;
  return { amount, percent };
}

export function purchasePriceVarianceLabel(referencePrice: number, actualUnitPrice: number): string | null {
  const variance = purchasePriceVariance(referencePrice, actualUnitPrice);
  if (!variance) return null;
  const amount = variance.amount.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const percent = variance.percent.toLocaleString("th-TH", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  return `⚠️ สูงกว่าราคาอ้างอิง +${amount} ฿ (+${percent}%)`;
}
