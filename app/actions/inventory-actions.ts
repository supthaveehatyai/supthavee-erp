"use server";

/**
 * Re-export Stock Card actions from canonical module.
 * Prefer importing from `@/lib/actions/inventory`.
 */
export {
  getProductStockCard,
  getStockCardByModel,
  getInventoryOverview,
  getInventoryOverviewByBrand,
  searchModelsForStockCard,
  searchBrandsForStockCard,
  type StockTransactionType,
  type ProductStockCardHeader,
  type StockCardMovement,
  type ProductStockCardData,
  type GetProductStockCardResult,
  type StockOverviewPayload,
  type StockCardModelView,
  type GetStockCardByModelResult,
  type InventoryOverviewPayload,
  type GetInventoryOverviewResult,
  type GetInventoryOverviewByBrandResult,
  type StockCardModelSearchItem,
  type SearchModelsForStockCardResult,
  type StockCardBrandSearchItem,
  type SearchBrandsForStockCardResult,
} from "@/lib/actions/inventory";
