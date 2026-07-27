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
import type { ProductSummary } from "../types";

type InternalProductComboboxProps = {
  products: ProductSummary[];
  value: string;
  onChange: (productId: string) => void;
  disabled?: boolean;
  placeholder?: string;
};

function productLabel(product: ProductSummary): string {
  const attrs = [product.color, product.size].filter(Boolean).join(" · ");
  return attrs
    ? `${product.sku} — ${product.name} (${attrs})`
    : `${product.sku} — ${product.name}`;
}

export function InternalProductCombobox({
  products,
  value,
  onChange,
  disabled = false,
  placeholder = "ค้นหา SKU ภายในเพื่อจับคู่...",
}: InternalProductComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const selected = products.find((item) => item.id === value);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("th");
    if (!keyword) return products.slice(0, 80);

    return products
      .filter((product) => {
        const haystack = [
          product.sku,
          product.name,
          product.color ?? "",
          product.size ?? "",
        ]
          .join(" ")
          .toLocaleLowerCase("th");
        return haystack.includes(keyword);
      })
      .slice(0, 80);
  }, [products, search]);

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
          className="h-auto min-h-9 w-full justify-between py-1.5 font-normal"
        >
          <span
            className={cn(
              "whitespace-normal break-words text-left text-xs leading-tight",
              selected ? "text-slate-800" : "text-slate-400",
            )}
          >
            {selected ? productLabel(selected) : placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 self-start text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[min(500px,calc(100vw-2rem))] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="SKU, ชื่อ, สี, ไซส์..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>ไม่พบสินค้า</CommandEmpty>
            <CommandGroup>
              {filtered.map((product) => {
                const isSelected = product.id === value;
                return (
                  <CommandItem
                    key={product.id}
                    value={product.id}
                    className="items-start"
                    onSelect={() => {
                      onChange(product.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-normal break-words font-mono text-xs font-semibold leading-tight">
                        {product.sku}
                      </p>
                      <p className="mt-0.5 whitespace-normal break-words text-[11px] leading-tight text-slate-500">
                        {product.name}
                        {[product.color, product.size].filter(Boolean).length > 0
                          ? ` · ${[product.color, product.size]
                              .filter(Boolean)
                              .join(" / ")}`
                          : ""}
                      </p>
                    </div>
                    <Check
                      className={cn(
                        "mt-0.5 size-4 shrink-0 text-blue-600",
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
