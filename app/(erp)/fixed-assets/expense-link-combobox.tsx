"use client";

/**
 * Presentational Combobox — Link Expense (data from Server Component).
 * Selecting an expense auto-fills acquisition cost via onSelect.
 */

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import type { LinkableExpenseOption } from "@/types/fixed-assets";
import { cn } from "@/lib/utils";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export type ExpenseLinkComboboxProps = {
  expenses: LinkableExpenseOption[];
  value: string;
  disabled?: boolean;
  onSelect: (selectedExpenseId: string | null) => void;
};

function parseDisplayAmount(value: number | string): number {
  if (typeof value === "string") {
    const parsed = parseFloat(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return Number.isFinite(value) ? value : 0;
}

function formatThaiBaht(value: number | string): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(parseDisplayAmount(value));
}

function formatDocDate(value: string): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function matchesSearch(row: LinkableExpenseOption, query: string): boolean {
  const keyword = query.trim().toLocaleLowerCase("th");
  if (!keyword) return true;
  return (
    row.document_no.toLocaleLowerCase("th").includes(keyword) ||
    formatThaiBaht(row.grand_total).toLocaleLowerCase("th").includes(keyword)
  );
}

export function ExpenseLinkCombobox({
  expenses,
  value,
  disabled = false,
  onSelect,
}: ExpenseLinkComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected =
    expenses.find((row) => String(row.id).trim() === String(value).trim()) ??
    null;

  const filtered = useMemo(
    () => expenses.filter((row) => matchesSearch(row, search)),
    [expenses, search],
  );

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex h-10 min-w-0 flex-1 items-center justify-between rounded-xl border border-slate-200 bg-white px-3 text-left text-sm shadow-sm outline-none transition",
              "focus:border-blue-400 focus:ring-2 focus:ring-blue-100",
              "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
              !selected && "text-slate-400",
            )}
          >
            <span className="truncate">
              {selected
                ? `${selected.document_no} · ${formatThaiBaht(selected.grand_total)}`
                : "เลือกบิลค่าใช้จ่าย (ถ้ามี)"}
            </span>
            <ChevronsUpDown className="ml-2 size-4 shrink-0 text-slate-400" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder="ค้นหาเลขที่เอกสาร..."
              value={search}
              onValueChange={setSearch}
            />
            <CommandList>
              <CommandEmpty>ไม่พบบิลค่าใช้จ่าย ISSUED / PAID</CommandEmpty>
              <CommandGroup>
                {filtered.map((row) => (
                  <CommandItem
                    key={row.id}
                    value={`${row.document_no} ${row.id}`}
                    onSelect={() => {
                      onSelect(String(row.id));
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 size-4",
                        value === String(row.id) ? "opacity-100" : "opacity-0",
                      )}
                    />
                    <div className="flex min-w-0 flex-col">
                      <span className="font-mono text-sm font-semibold">
                        {row.document_no}
                      </span>
                      <span className="text-xs text-slate-500">
                        {formatDocDate(row.expense_date)} ·{" "}
                        {formatThaiBaht(row.grand_total)}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected ? (
        <Button
          type="button"
          variant="outline"
          size="icon"
          disabled={disabled}
          aria-label="ล้างการอ้างอิงบิล"
          onClick={() => onSelect(null)}
        >
          <X className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}
