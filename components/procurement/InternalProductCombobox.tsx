"use client";

/**
 * Presentational internal-product Smart Combobox — does NOT fetch data.
 * Parent must pass `products` from a Server Action (Zero Client-Side Fetching).
 */

import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import type { ReceiptProductSummary } from "@/lib/actions/receipt";
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

export type InternalProductComboboxProps = {
  products: ReceiptProductSummary[];
  value: string;
  onChange: (productId: string) => void;
  disabled?: boolean;
  placeholder?: string;
  /**
   * "➕ สร้างสินค้ารุ่นใหม่ (Full Matrix)" — creates a brand-new product
   * model with a full color/size matrix. Rendered in the empty state when a
   * search yields no results. Wired to `FullMatrixDialog` by the parent
   * (`GoodsReceiptUI`) — a link-out to the `/products` Matrix Generator.
   */
  onCreateFullMatrix?: () => void;
  /**
   * "⚡ เพิ่มสี/ไซส์ จากรุ่นเดิม (Quick Create)" — adds a single new
   * color/size variant onto an existing model. Wired to `QuickCreateDialog`
   * by the parent (`GoodsReceiptUI`).
   */
  onQuickCreate?: () => void;
};

function productLabel(product: ReceiptProductSummary): string {
  const attrs = [product.color, product.size].filter(Boolean).join(" · ");
  return attrs
    ? `${product.sku} — ${product.name} (${attrs})`
    : `${product.sku} — ${product.name}`;
}

export default function InternalProductCombobox({
  products,
  value,
  onChange,
  disabled = false,
  placeholder = "ค้นหา SKU ภายในเพื่อจับคู่...",
  onCreateFullMatrix,
  onQuickCreate,
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
          className="h-9 w-full justify-between font-normal"
        >
          <span
            className={cn(
              "truncate text-left text-xs",
              selected ? "text-slate-800" : "text-slate-400",
            )}
          >
            {selected ? productLabel(selected) : placeholder}
          </span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-slate-400" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} className="p-0">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="SKU, ชื่อ, สี, ไซส์..."
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty className="flex flex-col items-center gap-2 px-3 py-4">
              <p className="text-xs text-slate-400">ไม่พบสินค้าที่ตรงกับคำค้นหา</p>
              {(onCreateFullMatrix || onQuickCreate) && (
                <div className="flex w-full flex-col gap-1.5">
                  {onCreateFullMatrix && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full justify-center gap-1.5 border border-dashed border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100"
                      onClick={() => {
                        setOpen(false);
                        setSearch("");
                        onCreateFullMatrix();
                      }}
                    >
                      ➕ สร้างสินค้ารุ่นใหม่ (Full Matrix)
                    </Button>
                  )}
                  {onQuickCreate && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      className="w-full justify-center gap-1.5 border border-dashed border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100"
                      onClick={() => {
                        setOpen(false);
                        setSearch("");
                        onQuickCreate();
                      }}
                    >
                      ⚡ เพิ่มสี/ไซส์ จากรุ่นเดิม (Quick Create)
                    </Button>
                  )}
                </div>
              )}
            </CommandEmpty>
            <CommandGroup>
              {filtered.map((product) => {
                const isSelected = product.id === value;
                return (
                  <CommandItem
                    key={product.id}
                    value={product.id}
                    onSelect={() => {
                      onChange(product.id);
                      setOpen(false);
                      setSearch("");
                    }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-mono text-xs font-semibold">
                        {product.sku}
                      </p>
                      <p className="truncate text-[11px] text-slate-500">
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
