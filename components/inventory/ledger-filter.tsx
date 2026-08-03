"use client";

/**
 * Inventory Overview filter — URL-driven (`q` / productId / dates).
 * Search filters models server-side via `getInventoryOverview(q)`.
 */

import { useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type LedgerFilterProps = {
  q?: string;
  productId?: string;
  startDate?: string;
  endDate?: string;
};

function buildLedgerUrl(next: {
  q?: string;
  productId?: string;
  startDate?: string;
  endDate?: string;
}): string {
  const params = new URLSearchParams();
  const q = next.q?.trim() ?? "";
  const productId = next.productId?.trim() ?? "";
  const startDate = next.startDate?.trim() ?? "";
  const endDate = next.endDate?.trim() ?? "";
  if (q) params.set("q", q);
  if (productId) params.set("productId", productId);
  if (startDate) params.set("startDate", startDate);
  if (endDate) params.set("endDate", endDate);
  const qs = params.toString();
  return qs ? `/inventory/ledger?${qs}` : "/inventory/ledger";
}

export function LedgerFilter({
  q = "",
  productId = "",
  startDate = "",
  endDate = "",
}: LedgerFilterProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function pushUrl(next: {
    q?: string;
    productId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    startTransition(() => {
      router.push(buildLedgerUrl(next), { scroll: false });
    });
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextQ = String(formData.get("q") ?? "").trim();
    pushUrl({
      q: nextQ,
      productId: "",
      startDate,
      endDate,
    });
  }

  function onStartDateChange(value: string) {
    pushUrl({ q, productId, startDate: value, endDate });
  }

  function onEndDateChange(value: string) {
    pushUrl({ q, productId, startDate, endDate: value });
  }

  function onClear() {
    startTransition(() => {
      router.push("/inventory/ledger", { scroll: false });
    });
  }

  const hasFilters = Boolean(q || productId || startDate || endDate);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <form
        onSubmit={onSubmit}
        className="grid gap-3 lg:grid-cols-[minmax(0,1.8fr)_repeat(2,minmax(0,1fr))_auto]"
      >
        <div className="space-y-1.5">
          <Label htmlFor="inventory-q" className="text-xs font-medium text-slate-600">
            ค้นหารุ่น (Model Code / Name)
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="inventory-q"
              name="q"
              defaultValue={q}
              disabled={isPending}
              placeholder="เว้นว่าง = แสดงทุกรุ่น · หรือพิมพ์รหัส/ชื่อรุ่น..."
              className="h-11 bg-white pl-9"
            />
          </div>
          <p className="text-xs text-slate-400">
            กรองที่ Server ผ่าน URL param <span className="font-mono">q</span> ·
            จัดกลุ่ม Brand → Model → Color → Size
          </p>
        </div>

        <div className="space-y-1.5">
          <Label
            htmlFor="ledger-start-date"
            className="text-xs font-medium text-slate-600"
          >
            ตั้งแต่วันที่ (Ledger)
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
            ถึงวันที่ (Ledger)
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

        <div className="flex items-end gap-2">
          <Button
            type="submit"
            disabled={isPending}
            className="h-11 w-full lg:w-auto"
          >
            ค้นหา
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!hasFilters || isPending}
            onClick={onClear}
            className="h-11 w-full gap-1.5 lg:w-auto"
          >
            <X className="h-3.5 w-3.5" />
            ล้าง
          </Button>
        </div>
      </form>
    </div>
  );
}
