"use client";

/**
 * Stock Card filter — URL-driven (productId / startDate / endDate).
 * Product search via SmartSkuPicker → Server Action only.
 */

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import SmartSkuPicker from "@/components/sales/smart-sku-picker";
import type { SalesProductSearchItem } from "@/types/document";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type LedgerFilterProps = {
  productId?: string;
  /** ข้อความแสดงสินค้าที่เลือกจาก Server (SKU · รุ่น · สี · ไซส์) */
  productLabel?: string | null;
  startDate?: string;
  endDate?: string;
};

function buildLedgerUrl(next: {
  productId?: string;
  startDate?: string;
  endDate?: string;
}): string {
  const params = new URLSearchParams();
  const productId = next.productId?.trim() ?? "";
  const startDate = next.startDate?.trim() ?? "";
  const endDate = next.endDate?.trim() ?? "";
  if (productId) params.set("productId", productId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const qs = params.toString();
  return qs ? `/inventory/ledger?${qs}` : "/inventory/ledger";
}

export function LedgerFilter({
  productId = "",
  productLabel = null,
  startDate = "",
  endDate = "",
}: LedgerFilterProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function pushUrl(next: {
    productId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    startTransition(() => {
      router.push(buildLedgerUrl(next), { scroll: false });
    });
  }

  function onSelectProduct(product: SalesProductSearchItem) {
    pushUrl({
      productId: product.id,
      startDate,
      endDate,
    });
  }

  function onStartDateChange(value: string) {
    pushUrl({ productId, startDate: value, endDate });
  }

  function onEndDateChange(value: string) {
    pushUrl({ productId, startDate, endDate: value });
  }

  function onClear() {
    startTransition(() => {
      router.push("/inventory/ledger", { scroll: false });
    });
  }

  const hasFilters = Boolean(productId || startDate || endDate);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.6fr)_repeat(2,minmax(0,1fr))_auto]">
        <div className="space-y-1.5">
          <Label className="text-xs font-medium text-slate-600">
            สินค้า (Product)
          </Label>
          <SmartSkuPicker
            placeholder="ค้นหา SKU, รุ่น, สี, ไซส์..."
            onSelectProduct={onSelectProduct}
            disabled={isPending}
          />
          {productId && productLabel ? (
            <p className="truncate text-xs text-slate-600">
              เลือกแล้ว:{" "}
              <span className="font-semibold text-slate-800">{productLabel}</span>
            </p>
          ) : productId ? (
            <p className="truncate font-mono text-xs text-slate-500">
              productId: {productId.slice(0, 8)}…
            </p>
          ) : (
            <p className="text-xs text-slate-400">
              เลือกสินค้าเพื่อดูบัตรสต็อก (Stock Card)
            </p>
          )}
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="ledger-start-date"
            className="text-xs font-medium text-slate-600"
          >
            ตั้งแต่วันที่
          </Label>
          <Input
            id="ledger-start-date"
            type="date"
            value={startDate}
            disabled={isPending}
            onChange={(e) => onStartDateChange(e.target.value)}
            className="h-11 bg-white"
          />
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="ledger-end-date"
            className="text-xs font-medium text-slate-600"
          >
            ถึงวันที่
          </Label>
          <Input
            id="ledger-end-date"
            type="date"
            value={endDate}
            disabled={isPending}
            onChange={(e) => onEndDateChange(e.target.value)}
            className="h-11 bg-white"
          />
        </div>

        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            disabled={!hasFilters || isPending}
            onClick={onClear}
            className="h-11 w-full gap-1.5 lg:w-auto"
          >
            <X className="h-3.5 w-3.5" />
            ล้างตัวกรอง
          </Button>
        </div>
      </div>
    </div>
  );
}
