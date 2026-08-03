import type { Metadata } from "next";
import { Suspense } from "react";
import { Warehouse } from "lucide-react";
import {
  getInventoryOverview,
  getProductStockCard,
} from "@/lib/actions/inventory";
import { LedgerFilter } from "@/components/inventory/ledger-filter";
import { LedgerSheet } from "@/components/inventory/ledger-sheet";
import { StockCardMatrix } from "@/components/inventory/stock-card-matrix";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "บัตรสต็อก (Stock Card) | Inventory Overview",
  description: "ภาพรวมคลังสินค้าตามแบรนด์ — ยอดคงเหลือและความเคลื่อนไหวสต็อก",
};

type PageProps = {
  searchParams: Promise<{
    q?: string;
    productId?: string;
    startDate?: string;
    endDate?: string;
  }>;
};

export default async function InventoryLedgerPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const productId = params.productId?.trim() ?? "";
  const startDate = params.startDate?.trim() ?? "";
  const endDate = params.endDate?.trim() ?? "";

  const [overviewResult, ledgerResult] = await Promise.all([
    getInventoryOverview(q || undefined),
    productId
      ? getProductStockCard(
          productId,
          startDate || undefined,
          endDate || undefined,
        )
      : Promise.resolve(null),
  ]);

  const sheetOpen = Boolean(productId);
  const sheetData =
    ledgerResult?.success && ledgerResult.data ? ledgerResult.data : null;
  const sheetError =
    productId && ledgerResult && !ledgerResult.success
      ? ledgerResult.error
      : null;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-2">
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
          <Warehouse className="h-8 w-8 text-blue-600" />
          บัตรสต็อก (Inventory Overview)
        </h1>
        <p className="text-sm text-slate-500">
          Brand → Model → Color → Size (เรียงตาม mst_sizes.sort_order) ·
          กดดูความเคลื่อนไหวเพื่อเปิด Ledger แบบ Slide-over
        </p>
      </div>

      <Suspense
        fallback={
          <div className="h-28 animate-pulse rounded-xl border border-slate-200 bg-slate-50" />
        }
      >
        <LedgerFilter
          q={q}
          productId={productId}
          startDate={startDate}
          endDate={endDate}
        />
      </Suspense>

      {overviewResult && !overviewResult.success ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {overviewResult.error}
        </div>
      ) : null}

      {overviewResult?.success ? (
        <StockCardMatrix
          brands={overviewResult.data}
          selectedProductId={productId}
          q={q}
          startDate={startDate}
          endDate={endDate}
        />
      ) : null}

      <LedgerSheet
        open={sheetOpen}
        data={sheetData}
        error={sheetError}
        q={q}
        startDate={startDate}
        endDate={endDate}
      />
    </div>
  );
}
