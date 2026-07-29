"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const SEARCH_DEBOUNCE_MS = 300;

export type DocumentFilterProps = {
  /** Placeholder for the search input (sales vs purchase wording). */
  searchPlaceholder?: string;
};

/**
 * Shared URL-driven document list filter (search / from / to).
 * Updates query params via router.replace — Server Components re-fetch data.
 */
export default function DocumentFilter({
  searchPlaceholder = "เลขภายใน / เลขอ้างอิงบิล / ชื่อคู่ค้า",
}: DocumentFilterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const urlSearch = searchParams.get("search") ?? "";
  const urlFrom = searchParams.get("from") ?? "";
  const urlTo = searchParams.get("to") ?? "";

  const [search, setSearch] = useState(urlSearch);
  const [from, setFrom] = useState(urlFrom);
  const [to, setTo] = useState(urlTo);

  const latestRef = useRef({ search, from, to, urlSearch, pathname });
  latestRef.current = { search, from, to, urlSearch, pathname };

  useEffect(() => {
    setSearch(urlSearch);
    setFrom(urlFrom);
    setTo(urlTo);
  }, [urlSearch, urlFrom, urlTo]);

  function replaceParams(next: {
    search?: string;
    from?: string;
    to?: string;
  }) {
    const params = new URLSearchParams(searchParams.toString());

    const apply = (key: "search" | "from" | "to", value: string | undefined) => {
      const trimmed = value?.trim() ?? "";
      if (trimmed) params.set(key, trimmed);
      else params.delete(key);
    };

    apply("search", next.search);
    apply("from", next.from);
    apply("to", next.to);

    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const latest = latestRef.current;
      if (latest.search.trim() === latest.urlSearch.trim()) return;

      const params = new URLSearchParams();
      const s = latest.search.trim();
      const f = latest.from.trim();
      const t = latest.to.trim();
      if (s) params.set("search", s);
      if (f) params.set("from", f);
      if (t) params.set("to", t);

      const qs = params.toString();
      startTransition(() => {
        router.replace(qs ? `${latest.pathname}?${qs}` : latest.pathname, {
          scroll: false,
        });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [search, router, startTransition]);

  function onFromChange(value: string) {
    setFrom(value);
    replaceParams({ search, from: value, to });
  }

  function onToChange(value: string) {
    setTo(value);
    replaceParams({ search, from, to: value });
  }

  function onClear() {
    setSearch("");
    setFrom("");
    setTo("");
    startTransition(() => {
      router.replace(pathname, { scroll: false });
    });
  }

  const hasFilters = Boolean(
    urlSearch || urlFrom || urlTo || search || from || to,
  );

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_repeat(2,minmax(0,1fr))_auto]">
        <div className="space-y-1.5">
          <label
            htmlFor="document-filter-search"
            className="text-xs font-semibold text-slate-600"
          >
            ค้นหา
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              id="document-filter-search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              className="pl-9"
              autoComplete="off"
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="document-filter-from"
            className="text-xs font-semibold text-slate-600"
          >
            วันที่เริ่ม (From)
          </label>
          <Input
            id="document-filter-from"
            type="date"
            value={from}
            onChange={(e) => onFromChange(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <label
            htmlFor="document-filter-to"
            className="text-xs font-semibold text-slate-600"
          >
            วันที่สิ้นสุด (To)
          </label>
          <Input
            id="document-filter-to"
            type="date"
            value={to}
            onChange={(e) => onToChange(e.target.value)}
          />
        </div>

        <div className="flex items-end">
          <Button
            type="button"
            variant="outline"
            onClick={onClear}
            disabled={!hasFilters}
            className="w-full gap-1.5 md:w-auto"
          >
            <X className="size-4" />
            ล้างค่า (Clear)
          </Button>
        </div>
      </div>
    </div>
  );
}
