"use client";

/**
 * Customer Smart Combobox — presentational only.
 * Options come from `listActiveCustomers()` (Server Action) via the parent.
 */

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import type { CustomerOption } from "@/types/document";
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

export type CustomerComboboxProps = {
  options: CustomerOption[];
  value: string;
  onChange: (contactId: string) => void;
  disabled?: boolean;
  isLoading?: boolean;
  placeholder?: string;
  emptyMessage?: string;
};

export default function CustomerCombobox({
  options,
  value,
  onChange,
  disabled = false,
  isLoading = false,
  placeholder = "ค้นหาและเลือกลูกค้า...",
  emptyMessage = "ไม่พบลูกค้า",
}: CustomerComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = options.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return options;
    return options.filter((item) =>
      item.company_name.toLocaleLowerCase("th").includes(keyword),
    );
  }, [options, search]);

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
          className="h-10 w-full justify-between font-normal"
        >
          <span
            className={cn(
              "truncate",
              selected ? "text-slate-800" : "text-slate-400",
            )}
          >
            {isLoading
              ? "กำลังโหลดลูกค้า..."
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
      <PopoverContent align="start" sideOffset={6} className="w-[var(--radix-popover-trigger-width)] p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="พิมพ์ชื่อลูกค้า..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            <CommandGroup>
              {filtered.map((customer) => {
                const isSelected = customer.id === value;
                return (
                  <CommandItem
                    key={customer.id}
                    value={customer.id}
                    onSelect={() => {
                      onChange(customer.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <span className="flex-1 truncate">
                      {customer.company_name}
                    </span>
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
