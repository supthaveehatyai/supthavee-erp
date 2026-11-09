import type { InventoryOverviewPayload } from "@/lib/actions/inventory";

export type StockQuickFilter = "all" | "negative" | "positive";

export function parseStockQuickFilter(value: string | undefined): StockQuickFilter {
  if (value === "negative" || value === "positive") return value;
  return "all";
}

function matchesBalance(balance: number, filter: StockQuickFilter): boolean {
  if (filter === "negative") return balance < 0;
  if (filter === "positive") return balance > 0;
  return true;
}

/** เหลือเฉพาะไซส์ที่เข้าเงื่อนไข แล้วตัดสี/รุ่น/แบรนด์ที่ไม่มีไซส์เหลือ */
export function filterInventoryOverview(
  brands: InventoryOverviewPayload[],
  filter: StockQuickFilter,
): InventoryOverviewPayload[] {
  if (filter === "all") return brands;

  return brands
    .map((brand) => {
      const models = brand.models
        .map((model) => {
          const colors = model.colors
            .map((color) => {
              const sizes = color.sizes.filter((size) =>
                matchesBalance(size.current_balance, filter),
              );
              return {
                ...color,
                sizes,
                total_color_qty: sizes.reduce((sum, size) => sum + size.current_balance, 0),
              };
            })
            .filter((color) => color.sizes.length > 0);
          return {
            ...model,
            colors,
            total_model_qty: colors.reduce((sum, color) => sum + color.total_color_qty, 0),
          };
        })
        .filter((model) => model.colors.length > 0);
      return {
        ...brand,
        models,
        total_brand_qty: models.reduce((sum, model) => sum + model.total_model_qty, 0),
      };
    })
    .filter((brand) => brand.models.length > 0);
}
