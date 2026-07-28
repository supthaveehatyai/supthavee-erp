"use client";

/**
 * Smart SKU Picker — product search via Server Action only.
 *
 * Zero Client-Side Fetching: debounced `searchProductsForSales` (Service Role).
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { ChevronsUpDown, Loader2, PackageSearch } from "lucide-react";
import { searchProductsForSales } from "@/lib/actions/document-actions";
import type { SalesProductSearchItem } from "@/types/document";
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

const SEARCH_DEBOUNCE_MS = 300;

export type SmartSkuPickerProps = {
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** Fires with the full product payload (incl. cost_price) when user picks a row. */
  onSelectProduct: (product: SalesProductSearchItem) => void;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function SmartSkuPicker({
  disabled = false,
  className,
  placeholder = "ค้นหา SKU หรือชื่อรุ่น...",
  onSelectProduct,
}: SmartSkuPickerProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SalesProductSearchItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  useEffect(() => {
    if (!open) return;

    if (debouncedQuery.length < 1) {
      setResults([]);
      setError(null);
      return;
    }

    let active = true;
    startTransition(async () => {
      try {
        const result = await searchProductsForSales(debouncedQuery);
        if (!active) return;
        if (result.error) {
          setError(result.error);
          setResults([]);
          return;
        }
        setError(null);
        setResults(Array.isArray(result.data) ? result.data : []);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "ค้นหาสินค้าไม่สำเร็จ",
        );
        setResults([]);
      }
    });

    return () => {
      active = false;
    };
  }, [debouncedQuery, open]);

  function pickProduct(product: SalesProductSearchItem) {
    onSelectProduct(product);
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setError(null);
  }

  function closePicker() {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setError(null);
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) return;
          if (next) setOpen(true);
          else closePicker();
        }}
        modal={false}
      >
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-controls={listboxId}
            disabled={disabled}
            className="h-11 w-full justify-between font-normal"
          >
            <span className="flex min-w-0 items-center gap-2 text-slate-400">
              <PackageSearch className="size-4 shrink-0 text-blue-600" />
              <span className="truncate">{placeholder}</span>
            </span>
            {isPending ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-slate-400" />
            ) : (
              <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="z-[9999] w-[var(--radix-popover-trigger-width)] p-0 sm:w-[28rem]"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <Command shouldFilter={false} id={listboxId}>
            <CommandInput
              ref={inputRef}
              placeholder="พิมพ์ SKU หรือชื่อรุ่นสินค้า..."
              value={query}
              onValueChange={setQuery}
              disabled={disabled}
            />
            <CommandList>
              {error ? (
                <div className="px-3 py-4 text-center text-xs text-red-600">
                  {error}
                </div>
              ) : null}

              {!error && isPending && debouncedQuery.length > 0 ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-slate-400">
                  <Loader2 className="size-3.5 animate-spin" />
                  กำลังค้นหาผ่าน Server Action...
                </div>
              ) : null}

              {!error && !isPending && debouncedQuery.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-slate-400">
                  พิมพ์อย่างน้อย 1 ตัวอักษรเพื่อค้นหา
                </div>
              ) : null}

              {!error &&
              !isPending &&
              debouncedQuery.length > 0 &&
              results.length === 0 ? (
                <CommandEmpty>ไม่พบสินค้าที่ตรงกับคำค้น</CommandEmpty>
              ) : null}

              {!error && results.length > 0 ? (
                <CommandGroup heading={`ผลการค้นหา (${results.length})`}>
                  {results.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={`${product.sku} ${product.display_name}`}
                      onSelect={() => pickProduct(product)}
                      onMouseDown={(event) => {
                        // Keep focus stable; select even if cmdk onSelect is flaky.
                        event.preventDefault();
                        pickProduct(product);
                      }}
                      className="cursor-pointer items-start gap-2 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-semibold text-slate-900">
                          {product.sku}
                        </p>
                        <p className="truncate text-sm text-slate-700">
                          {product.display_name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          ราคา {formatMoney(product.unit_price)} ฿ · ต้นทุน{" "}
                          {formatMoney(product.cost_price)} ฿
                          {product.base_uom ? ` · ${product.base_uom}` : ""}
                        </p>
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
