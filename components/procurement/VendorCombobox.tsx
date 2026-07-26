"use client";

/**
 * Presentational Vendor Combobox — does NOT fetch data.
 * Parent must pass `options` from getActiveVendors() Server Action.
 */

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import type { VendorOption } from "@/lib/actions/mapping";
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

export type VendorComboboxProps = {
  /** Vendor list from parent (Server Action) — never fetched inside this component */
  options?: VendorOption[] | null;
  value: string;
  onChange: (vendorId: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
};

export default function VendorCombobox({
  options,
  value,
  onChange,
  disabled = false,
  isLoading = false,
  placeholder = "ค้นหาและเลือกผู้จำหน่าย (Vendor)...",
  emptyMessage = "ไม่พบผู้จำหน่าย",
}: VendorComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Guard against undefined/null when parent fetch fails
  const safeOptions = options || [];

  const selected = safeOptions.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return safeOptions;
    return safeOptions.filter((item) =>
      item.company_name.toLocaleLowerCase("th").includes(keyword),
    );
  }, [safeOptions, search]);

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
          className="h-11 w-full max-w-xl justify-between font-normal"
        >
          <span
            className={cn(
              "truncate",
              selected ? "text-slate-800" : "text-slate-400",
            )}
          >
            {isLoading
              ? "กำลังโหลดผู้จำหน่าย..."
              : selected
                ? selected.company_name
                : placeholder}
          </span>
          {isLoading ? (
            <Loader2 className="size-4 shrink-0 animate-spin text-slate-400" />
          ) : (
            <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="พิมพ์ชื่อผู้จำหน่าย..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {filtered.map((vendor) => {
                const isSelected = vendor.id === value;
                return (
                  <CommandItem
                    key={vendor.id}
                    value={vendor.id}
                    onSelect={() => {
                      onChange(vendor.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <span className="flex-1 truncate">{vendor.company_name}</span>
                    <Check
                      className={cn(
                        "size-4 text-blue-600",
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
