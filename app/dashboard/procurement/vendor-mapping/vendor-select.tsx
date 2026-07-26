"use client";

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
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
import type { VendorOption } from "./types";

type VendorSelectProps = {
  vendors: VendorOption[];
  value: string;
  onChange: (vendorId: string) => void;
  disabled?: boolean;
};

export function VendorSelect({
  vendors,
  value,
  onChange,
  disabled = false,
}: VendorSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = vendors.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return vendors;
    return vendors.filter((item) =>
      item.company_name.toLocaleLowerCase("th").includes(keyword),
    );
  }, [vendors, search]);

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
          disabled={disabled}
          className="h-11 w-full justify-between font-normal"
        >
          <span
            className={cn(
              "truncate",
              selected ? "text-slate-800" : "text-slate-400",
            )}
          >
            {selected
              ? selected.company_name
              : "ค้นหาและเลือกผู้จำหน่าย (Vendor)..."}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
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
            <CommandEmpty>ไม่พบผู้จำหน่าย</CommandEmpty>
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
