/**
 * Size sort helpers — map `products.size` (label or code string) to
 * `mst_sizes.sort_order`. Keep outside `"use server"` modules.
 */

export type SizeSortRef = {
  size_code: string;
  size_label: string;
  sort_order: number;
};

export function buildSizeSortIndex(
  catalog: SizeSortRef[],
): Map<string, number> {
  const index = new Map<string, number>();

  for (const size of catalog) {
    const order = Number(size.sort_order);
    const weight = Number.isFinite(order) ? order : 9999;
    const label = size.size_label.trim().toUpperCase();
    const code = size.size_code.trim().toUpperCase();

    if (label) {
      const previous = index.get(label);
      if (previous === undefined || weight < previous) {
        index.set(label, weight);
      }
    }
    if (code) {
      const previous = index.get(code);
      if (previous === undefined || weight < previous) {
        index.set(code, weight);
      }
    }
  }

  return index;
}

export function compareSizesBySortOrder(
  left: string,
  right: string,
  index: Map<string, number>,
  fallbackWeight?: (key: string) => number,
): number {
  const leftKey = left.trim().toUpperCase();
  const rightKey = right.trim().toUpperCase();
  const leftWeight =
    index.get(leftKey) ?? fallbackWeight?.(leftKey) ?? 9999;
  const rightWeight =
    index.get(rightKey) ?? fallbackWeight?.(rightKey) ?? 9999;

  if (leftWeight !== rightWeight) return leftWeight - rightWeight;
  return left.localeCompare(right, "th", {
    numeric: true,
    sensitivity: "base",
  });
}
