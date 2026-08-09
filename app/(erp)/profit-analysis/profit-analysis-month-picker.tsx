"use client";

/**
 * URL-driven Month Picker for Profit Analysis (`?month=YYYY-MM`).
 * Data re-fetches on the Server Component parent — Zero Client-Side Fetching.
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ProfitAnalysisMonthPickerProps = {
  /** Current month in YYYY-MM */
  month: string;
};

export function ProfitAnalysisMonthPicker({
  month,
}: ProfitAnalysisMonthPickerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onMonthChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) {
      params.set("month", value);
    } else {
      params.delete("month");
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex min-w-[12rem] flex-col gap-1.5">
        <Label htmlFor="profit-month" className="text-xs font-medium text-slate-500">
          เดือนที่วิเคราะห์
        </Label>
        <Input
          id="profit-month"
          type="month"
          value={month}
          disabled={isPending}
          onChange={(e) => onMonthChange(e.target.value)}
          className={cn("w-[12.5rem]", isPending && "opacity-70")}
        />
      </div>
      {isPending ? (
        <span className="pb-2 text-xs text-slate-400">กำลังโหลด…</span>
      ) : null}
    </div>
  );
}
