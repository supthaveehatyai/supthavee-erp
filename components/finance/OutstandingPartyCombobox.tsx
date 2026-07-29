"use client";

/**
 * Presentational Smart Combobox for AR/AP outstanding parties.
 * Options come from Server Actions — never fetches Supabase on the client.
 */

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
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

export type OutstandingPartyOption = {
  id: string;
  name: string;
  outstanding_total: number;
  invoice_count: number;
};

export type OutstandingPartyComboboxProps = {
  options: OutstandingPartyOption[];
  value: string;
  onChange: (id: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
  searchPlaceholder?: string;
  /** Accent for focus ring — AR blue / AP orange */
  accent?: "blue" | "orange";
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function formatOutstandingLabel(option: OutstandingPartyOption): string {
  return `${option.name} - ค้างชำระ ${formatMoney(option.outstanding_total)} บาท`;
}

export function OutstandingPartyCombobox({
  options,
  value,
  onChange,
  disabled = false,
  isLoading = false,
  placeholder = "ค้นหาและเลือกรายชื่อที่มียอดค้าง...",
  emptyMessage = "ไม่พบรายชื่อที่มียอดค้างชำระ",
  searchPlaceholder = "พิมพ์ชื่อเพื่อค้นหา...",
  accent = "blue",
}: OutstandingPartyComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = options.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return options;
    return options.filter((item) => {
      const haystack =
        `${item.name} ${formatMoney(item.outstanding_total)}`.toLocaleLowerCase(
          "th",
        );
      return haystack.includes(keyword);
    });
  }, [options, search]);

  const focusRing =
    accent === "orange"
      ? "focus-visible:border-orange-500 focus-visible:ring-orange-500/20"
      : "focus-visible:border-blue-500 focus-visible:ring-blue-500/20";

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        setOpen(next);
        if (!next) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled || isLoading}
          className={cn(
            "h-10 w-full max-w-xl justify-between font-normal",
            focusRing,
          )}
        >
          <span
            className={cn(
              "truncate text-left",
              selected ? "text-slate-800" : "text-slate-400",
            )}
          >
            {isLoading
              ? "กำลังโหลด..."
              : selected
                ? formatOutstandingLabel(selected)
                : placeholder}
          </span>
          {isLoading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-slate-400" />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={6}
        className="w-[var(--radix-popover-trigger-width)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {filtered.map((item) => {
                const isSelected = item.id === value;
                return (
                  <CommandItem
                    key={item.id}
                    value={item.id}
                    onSelect={() => {
                      onChange(item.id);
                      setOpen(false);
                      setSearch("");
                    }}
                    className="flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-900">
                        {item.name}
                      </p>
                      <p className="text-xs text-slate-500">
                        {item.invoice_count} บิล · ค้างชำระ{" "}
                        <span className="font-semibold text-red-600">
                          {formatMoney(item.outstanding_total)} บาท
                        </span>
                      </p>
                    </div>
                    <Check
                      className={cn(
                        "mt-0.5 size-4 shrink-0",
                        isSelected ? "opacity-100" : "opacity-0",
                      )}
                    />
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
