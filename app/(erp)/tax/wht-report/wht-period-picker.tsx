"use client";

/**
 * URL-driven Month/Year picker — updates searchParams only.
 * Data re-fetches on the Server Component parent (Zero Client-Side Fetching).
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/select";

const THAI_MONTHS = [
  { value: 1, label: "มกราคม" },
  { value: 2, label: "กุมภาพันธ์" },
  { value: 3, label: "มีนาคม" },
  { value: 4, label: "เมษายน" },
  { value: 5, label: "พฤษภาคม" },
  { value: 6, label: "มิถุนายน" },
  { value: 7, label: "กรกฎาคม" },
  { value: 8, label: "สิงหาคม" },
  { value: 9, label: "กันยายน" },
  { value: 10, label: "ตุลาคม" },
  { value: 11, label: "พฤศจิกายน" },
  { value: 12, label: "ธันวาคม" },
] as const;

export type WhtPeriodPickerProps = {
  year: number;
  month: number;
  /** Inclusive year range around the selected year */
  yearSpan?: number;
};

export function WhtPeriodPicker({
  year,
  month,
  yearSpan = 5,
}: WhtPeriodPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const years = Array.from({ length: yearSpan * 2 + 1 }, (_, i) => year - yearSpan + i);

  function pushPeriod(nextYear: number, nextMonth: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("year", String(nextYear));
    params.set("month", String(nextMonth));
    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-[10rem] flex-col gap-1.5">
        <label htmlFor="wht-month" className="text-xs font-medium text-slate-500">
          เดือน
        </label>
        <Select
          id="wht-month"
          value={String(month)}
          disabled={isPending}
          onChange={(e) => pushPeriod(year, Number(e.target.value))}
          className="w-[10.5rem]"
        >
          {THAI_MONTHS.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex min-w-[7rem] flex-col gap-1.5">
        <label htmlFor="wht-year" className="text-xs font-medium text-slate-500">
          ปี (ค.ศ.)
        </label>
        <Select
          id="wht-year"
          value={String(year)}
          disabled={isPending}
          onChange={(e) => pushPeriod(Number(e.target.value), month)}
          className="w-[7.5rem]"
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </Select>
      </div>

      {isPending ? (
        <span className="pb-2 text-xs text-slate-400">กำลังโหลด…</span>
      ) : null}
    </div>
  );
}
