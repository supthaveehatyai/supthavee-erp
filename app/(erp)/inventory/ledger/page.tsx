import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Warehouse } from "lucide-react";
import {
  getInventoryOverview,
  getProductStockCard,
} from "@/lib/actions/inventory";
import { LedgerFilter } from "@/components/inventory/ledger-filter";
import { LedgerSheet } from "@/components/inventory/ledger-sheet";
import { StockCardMatrix } from "@/components/inventory/stock-card-matrix";
import {
  filterInventoryOverview,
  parseStockQuickFilter,
  type StockQuickFilter,
} from "@/lib/inventory/filter-stock-overview";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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
    stock?: string;
  }>;
};

const STOCK_PILLS: Array<{ id: StockQuickFilter; label: string }> = [
  { id: "all", label: "ทั้งหมด (All)" },
  { id: "negative", label: "🔴 เฉพาะสต็อกติดลบ (< 0)" },
  { id: "positive", label: "🟢 มีสินค้าคงเหลือ (> 0)" },
];

function ledgerHref(
  stock: StockQuickFilter,
  current: { q: string; productId: string; startDate: string; endDate: string },
): string {
  const params = new URLSearchParams();
  if (current.q) params.set("q", current.q);
  if (current.productId) params.set("productId", current.productId);
  if (current.startDate) params.set("startDate", current.startDate);
  if (current.endDate) params.set("endDate", current.endDate);
  if (stock !== "all") params.set("stock", stock);
  const query = params.toString();
  return query ? `/inventory/ledger?${query}` : "/inventory/ledger";
}

export default async function InventoryLedgerPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const q = params.q?.trim() ?? "";
  const productId = params.productId?.trim() ?? "";
  const startDate = params.startDate?.trim() ?? "";
  const endDate = params.endDate?.trim() ?? "";
  const stock = parseStockQuickFilter(params.stock);

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
          stock={stock === "all" ? "" : stock}
        />
      </Suspense>

      <div className="flex flex-wrap gap-2">
        {STOCK_PILLS.map((pill) => {
          const active = stock === pill.id;
          return (
            <Link
              key={pill.id}
              href={ledgerHref(pill.id, { q, productId, startDate, endDate })}
              className={
                active
                  ? "rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white"
                  : "rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              }
              aria-current={active ? "page" : undefined}
            >
              {pill.label}
            </Link>
          );
        })}
      </div>

      {overviewResult && !overviewResult.success ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {overviewResult.error}
        </div>
      ) : null}

      {overviewResult?.success ? (
        <StockCardMatrix
          brands={filterInventoryOverview(overviewResult.data, stock)}
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
