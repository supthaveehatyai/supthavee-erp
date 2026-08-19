"use client";

/**
 * Smart Matrix Selection — ปรับปรุงสต็อก (STK_OB / STK_ADJ)
 * Zero Client-Side Fetching: searchProductModels + getModelMatrixForSale
 */

import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  ChevronsUpDown,
  Loader2,
  PackageSearch,
  Plus,
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
import type { AdjustmentFormLine } from "@/types/inventory-adjustment";
import type { InventoryDocType } from "@/lib/constants/document";
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

export type AdjustmentMatrixPickerProps = {
  docType: InventoryDocType;
  disabled?: boolean;
  onAddLines: (lines: AdjustmentFormLine[]) => void;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
}

function formatStock(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 0 });
}

function skuLabel(sku: ModelMatrixSkuRow, modelName: string): string {
  const parts = [
    sku.name?.trim() || modelName,
    sku.color_name?.trim(),
    sku.size_label?.trim(),
  ].filter(Boolean);
  return parts.join(" · ") || sku.sku;
}

export function AdjustmentMatrixPicker({
  docType,
  disabled = false,
  onAddLines,
}: AdjustmentMatrixPickerProps) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const isOpeningBalance = docType === "STK_OB";

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
  const [costByProductId, setCostByProductId] = useState<
    Record<string, string>
  >({});
  const [isMatrixPending, startMatrixTransition] = useTransition();

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 10);
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
        setResults(
          result.data.filter((model) => !model.is_service),
        );
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
    if (model.is_service) return;
    closeSearch();
    setSelectedModel(model);
    setMatrix(null);
    setMatrixError(null);
    setQtyByProductId({});
    setCostByProductId({});
    setMatrixOpen(true);

    startMatrixTransition(async () => {
      try {
        const result = await getModelMatrixForSale(model.id);
        if (!result.success || !result.data) {
          setMatrixError(result.error || "โหลด Matrix ไม่สำเร็จ");
          setMatrix(null);
          return;
        }
        if (result.data.is_service) {
          setMatrixError("งานบริการไม่รองรับการปรับสต็อก");
          setMatrix(null);
          return;
        }
        setMatrixError(null);
        setMatrix(result.data);
        const defaultCosts: Record<string, string> = {};
        for (const sku of result.data.skus) {
          if (sku.cost_price > 0) {
            defaultCosts[sku.product_id] = String(sku.cost_price);
          }
        }
        setCostByProductId(defaultCosts);
      } catch (err) {
        setMatrixError(
          err instanceof Error ? err.message : "โหลด Matrix ไม่สำเร็จ",
        );
        setMatrix(null);
      }
    });
  }

  function handleAddLines() {
    if (!matrix) return;

    const lines: AdjustmentFormLine[] = [];
    for (const sku of matrix.skus) {
      const rawQty = qtyByProductId[sku.product_id] ?? "";
      const qty = Number.parseFloat(rawQty);
      if (!Number.isFinite(qty) || qty === 0) continue;

      if (isOpeningBalance && qty <= 0) continue;
      if (!isOpeningBalance && qty === 0) continue;

      const rawCost = costByProductId[sku.product_id] ?? "";
      const cost = rawCost.trim()
        ? Number.parseFloat(rawCost)
        : sku.cost_price;

      lines.push({
        product_id: sku.product_id,
        sku: sku.sku,
        display_name: skuLabel(sku, matrix.model_name),
        stock_balance: sku.stock_balance,
        qty: String(qty),
        unit_cost_price: Number.isFinite(cost) ? String(cost) : "",
      });
    }

    if (lines.length === 0) return;
    onAddLines(lines);
    setMatrixOpen(false);
    setSelectedModel(null);
    setMatrix(null);
    setQtyByProductId({});
    setCostByProductId({});
    setMatrixError(null);
  }

  const selectedCount = matrix
    ? matrix.skus.filter((sku) => {
        const qty = Number.parseFloat(qtyByProductId[sku.product_id] ?? "");
        return Number.isFinite(qty) && qty !== 0 && (isOpeningBalance ? qty > 0 : true);
      }).length
    : 0;

  return (
    <>
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
            <span className="flex min-w-0 items-center gap-2 text-slate-600">
              <PackageSearch className="size-4 shrink-0 text-blue-600" />
              <span className="truncate">
                ค้นหารุ่นสินค้า (Smart Matrix Selection)...
              </span>
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
                  กำลังค้นหา...
                </div>
              ) : null}
              {!searchError &&
              !isSearchPending &&
              debouncedQuery.length > 0 &&
              results.length === 0 ? (
                <CommandEmpty>ไม่พบรุ่นสินค้า (Trading Goods)</CommandEmpty>
              ) : null}
              {!searchError && results.length > 0 ? (
                <CommandGroup heading={`รุ่นสินค้า (${results.length})`}>
                  {results.map((model) => (
                    <CommandItem
                      key={model.id}
                      value={`${model.model_code} ${model.name}`}
                      onSelect={() => openMatrixForModel(model)}
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
            setCostByProductId({});
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
                  {selectedModel?.name ?? "เลือกสี / ไซส์ / จำนวน / ต้นทุน"}
                </span>
              </span>
            </DialogTitle>
            <DialogDescription>
              {isOpeningBalance
                ? "ยอดยกมา (STK_OB) — กรอกจำนวนบวกและต้นทุนต่อหน่วย"
                : "ปรับปรุงสต็อก (STK_ADJ) — จำนวนบวก = เข้า / ลบ = ออก"}
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

            {!isMatrixPending && !matrixError && matrix && matrix.skus.length > 0 ? (
              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead className="px-3 text-xs">SKU</TableHead>
                      <TableHead className="px-3 text-xs">สี</TableHead>
                      <TableHead className="px-3 text-xs">ไซส์</TableHead>
                      <TableHead className="px-3 text-right text-xs">
                        สต็อกคงเหลือ
                      </TableHead>
                      <TableHead className="w-28 px-3 text-xs">
                        {isOpeningBalance ? "ยอดยกมา (+)" : "ปรับ (+/−)"}
                      </TableHead>
                      <TableHead className="w-32 px-3 text-xs">
                        ต้นทุน/หน่วย
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {matrix.skus.map((sku) => {
                      const stockLow = sku.stock_balance <= 0;
                      return (
                        <TableRow key={sku.product_id}>
                          <TableCell className="px-3 font-mono text-xs">
                            {sku.sku}
                          </TableCell>
                          <TableCell className="px-3 text-sm">
                            {sku.color_name || "—"}
                          </TableCell>
                          <TableCell className="px-3 text-sm">
                            {sku.size_label || "—"}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "px-3 text-right text-sm tabular-nums",
                              stockLow
                                ? "font-semibold text-amber-600"
                                : "text-slate-700",
                            )}
                          >
                            {formatStock(sku.stock_balance)}
                          </TableCell>
                          <TableCell className="px-3">
                            <Input
                              type="number"
                              step="any"
                              inputMode="decimal"
                              placeholder={isOpeningBalance ? "0" : "+/−"}
                              min={isOpeningBalance ? 0 : undefined}
                              value={qtyByProductId[sku.product_id] ?? ""}
                              onChange={(e) =>
                                setQtyByProductId((c) => ({
                                  ...c,
                                  [sku.product_id]: e.target.value,
                                }))
                              }
                              className="h-9 text-right tabular-nums"
                            />
                          </TableCell>
                          <TableCell className="px-3">
                            <Input
                              type="number"
                              step="0.0001"
                              min={0}
                              inputMode="decimal"
                              placeholder={formatMoney(sku.cost_price)}
                              value={costByProductId[sku.product_id] ?? ""}
                              onChange={(e) =>
                                setCostByProductId((c) => ({
                                  ...c,
                                  [sku.product_id]: e.target.value,
                                }))
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
                : "กรอกจำนวนที่ไม่เป็น 0 อย่างน้อย 1 บรรทัด"}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setMatrixOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                disabled={selectedCount === 0 || isMatrixPending}
                className="gap-2"
                onClick={handleAddLines}
              >
                <Plus className="size-4" />
                เพิ่มรายการ
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
