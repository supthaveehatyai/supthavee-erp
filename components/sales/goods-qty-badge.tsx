import { summarizeGoodsQty, type GoodsQtyLine } from "@/lib/sales/goods-qty-summary";
import { cn } from "@/lib/utils";

export function GoodsQtyBadge({
  rows,
  className,
}: {
  rows: GoodsQtyLine[];
  className?: string;
}) {
  const summary = summarizeGoodsQty(rows);
  if (!summary.label) return null;
  return (
    <p
      className={cn(
        "rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-950",
        className,
      )}
    >
      {summary.label}
    </p>
  );
}
