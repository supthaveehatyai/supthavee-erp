"use client";

/**
 * Model-First Matrix Selection — ค้นหารุ่น → Dialog แจกแจง SKU (สี/ไซส์/สต็อก)
 * แล้วกรอกจำนวนหลายบรรทัดก่อน Add to Bill
 *
 * Zero Client-Side Fetching: searchProductModels + getModelMatrixForSale เท่านั้น
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  ChevronsUpDown,
  Loader2,
  PackageSearch,
  ShoppingCart,
} from "lucide-react";
import {
  getModelMatrixForSale,
  searchProductModels,
} from "@/lib/actions/product.actions";
import type {
  ModelMatrixForSale,
  ModelMatrixSkuRow,
  ProductModelSearchItem,
} from "@/types/product-sale";
import type { SalesProductSearchItem } from "@/types/document";
import { cn } from "@/lib/utils";
import { LineItemProductThumb } from "@/components/sales/LineItemProductThumb";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const SEARCH_DEBOUNCE_MS = 300;

export type ModelMatrixBillItem = SalesProductSearchItem & { qty: number };

export type ModelMatrixPickerProps = {
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** บรรทัดที่มีจำนวน > 0 จาก Matrix Dialog */
  onAddToBill: (items: ModelMatrixBillItem[]) => void;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatStock(value: number): string {
  return value.toLocaleString("th-TH", {
    maximumFractionDigits: 4,
  });
}

function skuDisplayName(sku: ModelMatrixSkuRow, modelName: string): string {
  const parts = [
    sku.name?.trim() || modelName,
    sku.color_name?.trim(),
    sku.size_label?.trim(),
  ].filter(Boolean);
  return parts.join(" · ") || sku.sku;
}

function toBillItem(
  sku: ModelMatrixSkuRow,
  matrix: ModelMatrixForSale,
  qty: number,
): ModelMatrixBillItem {
  return {
    id: sku.product_id,
    sku: sku.sku,
    unit_price: sku.unit_price,
    cost_price: sku.cost_price,
    display_name: skuDisplayName(sku, matrix.model_name),
    model_name: matrix.model_name,
    color_name: sku.color_name || null,
    size_label: sku.size_label || null,
    base_uom: sku.base_uom,
    image_url: matrix.image_url,
    qty,
  };
}

export default function ModelMatrixPicker({
  disabled = false,
  className,
  placeholder = "ค้นหารหัสรุ่นหรือชื่อรุ่นสินค้า...",
  onAddToBill,
}: ModelMatrixPickerProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<ProductModelSearchItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchPending, startSearchTransition] = useTransition();

  const [matrixOpen, setMatrixOpen] = useState(false);
  const [selectedModel, setSelectedModel] =
    useState<ProductModelSearchItem | null>(null);
  const [matrix, setMatrix] = useState<ModelMatrixForSale | null>(null);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [qtyByProductId, setQtyByProductId] = useState<Record<string, string>>(
    {},
  );
  const [isMatrixPending, startMatrixTransition] = useTransition();

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
      setSearchError(null);
      return;
    }

    let active = true;
    startSearchTransition(async () => {
      try {
        const result = await searchProductModels(debouncedQuery);
        if (!active) return;
        if (!result.success) {
          setSearchError(result.error);
          setResults([]);
          return;
        }
        setSearchError(null);
        setResults(result.data);
      } catch (err) {
        if (!active) return;
        setSearchError(
          err instanceof Error ? err.message : "ค้นหารุ่นสินค้าไม่สำเร็จ",
        );
        setResults([]);
      }
    });

    return () => {
      active = false;
    };
  }, [debouncedQuery, open]);

  function closeSearch() {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setSearchError(null);
  }

  function openMatrixForModel(model: ProductModelSearchItem) {
    closeSearch();
    setSelectedModel(model);
    setMatrix(null);
    setMatrixError(null);
    setQtyByProductId({});
    setMatrixOpen(true);

    startMatrixTransition(async () => {
      try {
        const result = await getModelMatrixForSale(model.id);
        if (!result.success || !result.data) {
          setMatrixError(result.error || "โหลด Matrix ไม่สำเร็จ");
          setMatrix(null);
          return;
        }
        setMatrixError(null);
        setMatrix(result.data);
      } catch (err) {
        setMatrixError(
          err instanceof Error ? err.message : "โหลด Matrix ไม่สำเร็จ",
        );
        setMatrix(null);
      }
    });
  }

  function setQty(productId: string, raw: string) {
    setQtyByProductId((current) => ({ ...current, [productId]: raw }));
  }

  function handleAddToBill() {
    if (!matrix) return;

    const items: ModelMatrixBillItem[] = [];
    for (const sku of matrix.skus) {
      const raw = qtyByProductId[sku.product_id] ?? "";
      const qty = Number.parseFloat(raw);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      // is_service: Bypass เช็คสต็อกคงเหลือ — เพิ่มลงบิลได้แม้สต็อกเป็น 0
      items.push(toBillItem(sku, matrix, qty));
    }

    if (items.length === 0) return;

    onAddToBill(items);
    setMatrixOpen(false);
    setSelectedModel(null);
    setMatrix(null);
    setQtyByProductId({});
    setMatrixError(null);
  }

  const selectedCount = matrix
    ? matrix.skus.filter((sku) => {
        const qty = Number.parseFloat(qtyByProductId[sku.product_id] ?? "");
        return Number.isFinite(qty) && qty > 0;
      }).length
    : 0;

  return (
    <div className={cn("space-y-1.5", className)}>
      <Popover
        open={open}
        onOpenChange={(next) => {
          if (disabled) return;
          if (next) setOpen(true);
          else closeSearch();
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
            {isSearchPending ? (
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
              placeholder="พิมพ์รหัสรุ่น หรือชื่อรุ่นสินค้า..."
              value={query}
              onValueChange={setQuery}
              disabled={disabled}
            />
            <CommandList>
              {searchError ? (
                <div className="px-3 py-4 text-center text-xs text-red-600">
                  {searchError}
                </div>
              ) : null}

              {!searchError && isSearchPending && debouncedQuery.length > 0 ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-slate-400">
                  <Loader2 className="size-3.5 animate-spin" />
                  กำลังค้นหารุ่นสินค้า...
                </div>
              ) : null}

              {!searchError &&
              !isSearchPending &&
              debouncedQuery.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-slate-400">
                  พิมพ์อย่างน้อย 1 ตัวอักษรเพื่อค้นหารุ่น
                </div>
              ) : null}

              {!searchError &&
              !isSearchPending &&
              debouncedQuery.length > 0 &&
              results.length === 0 ? (
                <CommandEmpty>ไม่พบรุ่นสินค้าที่ตรงกับคำค้น</CommandEmpty>
              ) : null}

              {!searchError && results.length > 0 ? (
                <CommandGroup heading={`รุ่นสินค้า (${results.length})`}>
                  {results.map((model) => (
                    <CommandItem
                      key={model.id}
                      value={`${model.model_code} ${model.name}`}
                      onSelect={() => openMatrixForModel(model)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        openMatrixForModel(model);
                      }}
                      className="cursor-pointer items-center gap-2 py-2"
                    >
                      <LineItemProductThumb
                        imageUrl={model.image_url}
                        alt={model.model_code}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-mono text-xs font-semibold text-slate-900">
                          {model.model_code}
                        </p>
                        <p className="truncate text-sm text-slate-700">
                          {model.name}
                        </p>
                      </div>
                      {model.is_service ? (
                        <span className="shrink-0 rounded-md bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700 ring-1 ring-violet-200">
                          บริการ
                        </span>
                      ) : null}
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      <Dialog
        open={matrixOpen}
        onOpenChange={(next) => {
          if (!next) {
            setMatrixOpen(false);
            setSelectedModel(null);
            setMatrix(null);
            setQtyByProductId({});
            setMatrixError(null);
          }
        }}
      >
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b border-slate-100 px-6 pt-6 pb-4">
            <DialogTitle className="flex items-center gap-3">
              <LineItemProductThumb
                imageUrl={
                  matrix?.image_url ?? selectedModel?.image_url ?? null
                }
                alt={selectedModel?.model_code ?? "รุ่น"}
                size="md"
              />
              <span className="min-w-0">
                <span className="block font-mono text-xs font-semibold text-slate-500">
                  {selectedModel?.model_code ?? "—"}
                </span>
                <span className="block truncate">
                  {selectedModel?.name ?? "เลือกสี / ไซส์ / จำนวน"}
                </span>
              </span>
            </DialogTitle>
            <DialogDescription>
              {matrix?.is_service
                ? "งานบริการ — ไม่เช็คสต็อกคงเหลือ สามารถเพิ่มลงบิลได้แม้สต็อกเป็น 0"
                : "กรอกจำนวนที่ต้องการขายในแต่ละ SKU แล้วกดเพิ่มรายการลงบิล"}
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
            {isMatrixPending ? (
              <div className="flex items-center justify-center gap-2 py-16 text-sm text-slate-400">
                <Loader2 className="size-4 animate-spin" />
                กำลังโหลด Matrix SKU...
              </div>
            ) : null}

            {!isMatrixPending && matrixError ? (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-6 text-center text-sm text-red-600">
                {matrixError}
              </div>
            ) : null}

            {!isMatrixPending && !matrixError && matrix?.skus.length === 0 ? (
              <div className="py-16 text-center text-sm text-slate-400">
                รุ่นนี้ยังไม่มี SKU ในระบบ
              </div>
            ) : null}

            {!isMatrixPending &&
            !matrixError &&
            matrix &&
            matrix.skus.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                      <TableHead className="px-3 text-xs font-semibold text-slate-500">
                        SKU
                      </TableHead>
                      <TableHead className="px-3 text-xs font-semibold text-slate-500">
                        สี
                      </TableHead>
                      <TableHead className="px-3 text-xs font-semibold text-slate-500">
                        ไซส์
                      </TableHead>
                      <TableHead className="px-3 text-right text-xs font-semibold text-slate-500">
                        พร้อมขาย (ATP)
                      </TableHead>
                      <TableHead className="px-3 text-right text-xs font-semibold text-slate-500">
                        ราคา/หน่วย
                      </TableHead>
                      <TableHead className="w-28 px-3 text-xs font-semibold text-slate-500">
                        จำนวน
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matrix.skus.map((sku) => {
                      const isService = matrix.is_service || sku.is_service;
                      const atp = sku.available_stock;
                      const stockLow = !isService && atp <= 0;
                      return (
                        <TableRow key={sku.product_id}>
                          <TableCell className="px-3 font-mono text-xs font-semibold text-slate-800">
                            {sku.sku}
                          </TableCell>
                          <TableCell className="px-3 text-sm text-slate-700">
                            {sku.color_name || "—"}
                            {sku.color_code ? (
                              <span className="ml-1 font-mono text-[10px] text-slate-400">
                                ({sku.color_code})
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="px-3 text-sm text-slate-700">
                            {sku.size_label || "—"}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "px-3 text-right text-sm tabular-nums",
                              isService
                                ? "font-semibold text-violet-700"
                                : stockLow
                                  ? "font-semibold text-amber-600"
                                  : "text-slate-700",
                            )}
                          >
                            {isService ? (
                              "บริการ (ไม่ตัดสต็อก)"
                            ) : (
                              <span title={`คงเหลือ ${formatStock(sku.stock_balance)} / จอง SO ${formatStock(sku.committed_qty)}`}>
                                {formatStock(atp)}
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="px-3 text-right text-sm tabular-nums text-slate-700">
                            {formatMoney(sku.unit_price)}
                          </TableCell>
                          <TableCell className="px-3">
                            <Input
                              type="number"
                              min={0}
                              step="any"
                              inputMode="decimal"
                              placeholder="0"
                              value={qtyByProductId[sku.product_id] ?? ""}
                              onChange={(event) =>
                                setQty(sku.product_id, event.target.value)
                              }
                              className="h-9 text-right tabular-nums"
                            />
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            ) : null}
          </div>

          <DialogFooter className="shrink-0 border-t border-slate-100 px-6 py-4 sm:justify-between">
            <p className="text-xs text-slate-500">
              {selectedCount > 0
                ? `เลือกแล้ว ${selectedCount} บรรทัด`
                : "กรอกจำนวน > 0 อย่างน้อย 1 บรรทัด"}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMatrixOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                disabled={selectedCount === 0 || isMatrixPending || !matrix}
                className="gap-2"
                onClick={handleAddToBill}
              >
                <ShoppingCart className="size-4" />
                เพิ่มรายการลงบิล (Add to Bill)
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
