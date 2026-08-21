"use client";

/**
 * URL-driven search + status filter for Fixed Assets list.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  FIXED_ASSET_STATUS_LABELS,
  FIXED_ASSET_STATUSES,
  type FixedAssetStatus,
} from "@/types/fixed-asset";

const SEARCH_DEBOUNCE_MS = 300;

export type FixedAssetFilterProps = {
  query: string;
  status: FixedAssetStatus | "ALL";
};

export function FixedAssetFilter({ query, status }: FixedAssetFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState(query);
  const latestRef = useRef({ search, status, pathname });
  latestRef.current = { search, status, pathname };

  useEffect(() => {
    setSearch(query);
  }, [query]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const current = latestRef.current;
      const nextQuery = current.search.trim();
      const urlQuery = (searchParams.get("query") ?? "").trim();
      if (nextQuery === urlQuery) return;

      const params = new URLSearchParams(searchParams.toString());
      if (nextQuery) params.set("query", nextQuery);
      else params.delete("query");
      // Keep sheet state keys only if still relevant
      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${pathname}?${qs}` : pathname);
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- debounce on search text only
  }, [search]);

  function updateStatus(nextStatus: string) {
    const params = new URLSearchParams(searchParams.toString());
    const normalized = nextStatus.trim().toUpperCase();
    if (!normalized || normalized === "ALL") {
      params.delete("status");
    } else {
      params.set("status", normalized);
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  function clearFilters() {
    setSearch("");
    const params = new URLSearchParams(searchParams.toString());
    params.delete("query");
    params.delete("status");
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname);
    });
  }

  const hasFilters = Boolean(query.trim() || (status && status !== "ALL"));

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-end">
      <div className="relative min-w-0 flex-1">
        <label className="mb-1.5 block text-xs font-semibold text-slate-600">
          ค้นหา
        </label>
        <Search className="pointer-events-none absolute bottom-2.5 left-3 size-4 text-slate-400" />
        <Input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="รหัส / ชื่อทรัพย์สิน / สถานที่ตั้ง"
          className="pl-9"
        />
      </div>
      <div className="w-full sm:w-52">
        <label className="mb-1.5 block text-xs font-semibold text-slate-600">
          สถานะ
        </label>
        <Select
          value={status === "ALL" ? "ALL" : status}
          onChange={(event) => updateStatus(event.target.value)}
        >
          <option value="ALL">ทั้งหมด</option>
          {FIXED_ASSET_STATUSES.map((value) => (
            <option key={value} value={value}>
              {FIXED_ASSET_STATUS_LABELS[value]}
            </option>
          ))}
        </Select>
      </div>
      {hasFilters ? (
        <Button
          type="button"
          variant="outline"
          className="shrink-0 gap-1.5"
          onClick={clearFilters}
        >
          <X className="size-4" />
          ล้างตัวกรอง
        </Button>
      ) : null}
    </div>
  );
}
