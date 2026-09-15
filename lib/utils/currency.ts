/**
 * Thai Baht formatting — shared by Executive Dashboard charts.
 */

export function formatThaiCurrency(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}
