"use client";

/**
 * Smart Matrix Selection — ปรับปรุงสต็อก (STK_OB / STK_ADJ)
 *
 * Renders an inline search box + expandable matrix table — no Popover/Portal
 * so it works correctly when hosted inside a Dialog (z-index stacking).
 *
 * Zero Client-Side Fetching: searchProductModels + getModelMatrixForSale
 */

import { useEffect, useRef, useState, useTransition } from "react";
import {
  ChevronDown,
  ChevronUp,
  Loader2,
  PackageSearch,
  Plus,
  X,
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
import { Input } from "@/components/ui/input";
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
  const inputRef = useRef<HTMLInputElement>(null);
  const isOpeningBalance = docType === "STK_OB";

  /* ── Search ── */
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<ProductModelSearchItem[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isSearchPending, startSearchTransition] = useTransition();
  const [searchFocused, setSearchFocused] = useState(false);
  const showDropdown = searchFocused && debouncedQuery.length > 0;

  /* ── Matrix ── */
  const [matrixExpanded, setMatrixExpanded] = useState(false);
  const [selectedModel, setSelectedModel] =
    useState<ProductModelSearchItem | null>(null);
  const [matrix, setMatrix] = useState<ModelMatrixForSale | null>(null);
  const [matrixError, setMatrixError] = useState<string | null>(null);
  const [qtyByProductId, setQtyByProductId] = useState<
    Record<string, string>
  >({});
  const [costByProductId, setCostByProductId] = useState<
    Record<string, string>
  >({});
  const [isMatrixPending, startMatrixTransition] = useTransition();

  /* ── Debounce ── */
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [query]);

  /* ── Search execution ── */
  useEffect(() => {
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
        setResults(result.data.filter((model) => !model.is_service));
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
  }, [debouncedQuery]);

  function openMatrixForModel(model: ProductModelSearchItem) {
    if (model.is_service) return;
    setQuery("");
    setDebouncedQuery("");
    setResults([]);
    setSearchFocused(false);
    setSelectedModel(model);
    setMatrix(null);
    setMatrixError(null);
    setQtyByProductId({});
    setCostByProductId({});
    setMatrixExpanded(true);

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

  function closeMatrix() {
    setMatrixExpanded(false);
    setSelectedModel(null);
    setMatrix(null);
    setQtyByProductId({});
    setCostByProductId({});
    setMatrixError(null);
  }

  function handleAddLines() {
    if (!matrix) return;

    const lines: AdjustmentFormLine[] = [];
    for (const sku of matrix.skus) {
      const rawQty = qtyByProductId[sku.product_id] ?? "";
      const qty = Number.parseFloat(rawQty);
      if (!Number.isFinite(qty) || qty === 0) continue;
      if (isOpeningBalance && qty <= 0) continue;

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
    closeMatrix();
  }

  const selectedCount = matrix
    ? matrix.skus.filter((sku) => {
        const qty = Number.parseFloat(qtyByProductId[sku.product_id] ?? "");
        return (
          Number.isFinite(qty) && qty !== 0 && (isOpeningBalance ? qty > 0 : true)
        );
      }).length
    : 0;

  return (
    <div className="space-y-3">
      {/* ── Inline Search ── */}
      <div className="relative">
        <div className="relative">
          <PackageSearch className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-blue-600" />
          <Input
            ref={inputRef}
            type="text"
            placeholder="ค้นหารุ่นสินค้า (Smart Matrix Selection)..."
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => {
              // delay so click on result registers first
              window.setTimeout(() => setSearchFocused(false), 200);
            }}
            className="h-11 pl-10 pr-10"
          />
          {isSearchPending && debouncedQuery.length > 0 ? (
            <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-slate-400" />
          ) : null}
        </div>

        {/* ── Search Results Dropdown (absolute, inside the same stacking context) ── */}
        {showDropdown ? (
          <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl">
            {searchError ? (
              <div className="px-4 py-6 text-center text-xs text-red-600">
                {searchError}
              </div>
            ) : isSearchPending ? (
              <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-slate-400">
                <Loader2 className="size-3.5 animate-spin" />
                กำลังค้นหา...
              </div>
            ) : results.length === 0 ? (
              <div className="px-4 py-6 text-center text-sm text-slate-500">
                ไม่พบรุ่นสินค้า (Trading Goods)
              </div>
            ) : (
              <ul className="divide-y divide-slate-100">
                {results.map((model) => (
                  <li key={model.id}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-blue-50"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        openMatrixForModel(model);
                      }}
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
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>

      {/* ── Inline Matrix Panel ── */}
      {matrixExpanded && selectedModel ? (
        <div className="overflow-hidden rounded-xl border border-blue-200 bg-blue-50/30">
          {/* Matrix header */}
          <div className="flex items-center gap-3 border-b border-blue-100 px-4 py-3">
            <LineItemProductThumb
              imageUrl={matrix?.image_url ?? selectedModel.image_url}
              alt={selectedModel.model_code}
              size="md"
            />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-xs font-semibold text-slate-500">
                {selectedModel.model_code}
              </p>
              <p className="truncate text-sm font-semibold text-slate-900">
                {selectedModel.name}
              </p>
              <p className="text-xs text-slate-500">
                {isOpeningBalance
                  ? "ยอดยกมา (STK_OB) — กรอกจำนวนบวกและต้นทุนต่อหน่วย"
                  : "ปรับปรุงสต็อก (STK_ADJ) — จำนวนบวก = เข้า / ลบ = ออก"}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={closeMatrix}
              aria-label="ปิด Matrix"
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Matrix body */}
          <div className="p-4">
            {isMatrixPending ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <Loader2 className="size-4 animate-spin" />
                กำลังโหลด Matrix SKU...
              </div>
            ) : matrixError ? (
              <div className="rounded-xl border border-red-100 bg-red-50 px-4 py-6 text-center text-sm text-red-600">
                {matrixError}
              </div>
            ) : matrix && matrix.skus.length > 0 ? (
              <>
                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
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
                        {isOpeningBalance ? (
                          <TableHead className="w-32 px-3 text-xs">
                            ต้นทุน/หน่วย
                          </TableHead>
                        ) : null}
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
                            {isOpeningBalance ? (
                              <TableCell className="px-3">
                                <Input
                                  type="number"
                                  step="0.0001"
                                  min={0}
                                  inputMode="decimal"
                                  placeholder={formatMoney(sku.cost_price)}
                                  value={
                                    costByProductId[sku.product_id] ?? ""
                                  }
                                  onChange={(e) =>
                                    setCostByProductId((c) => ({
                                      ...c,
                                      [sku.product_id]: e.target.value,
                                    }))
                                  }
                                  className="h-9 text-right tabular-nums"
                                />
                              </TableCell>
                            ) : null}
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-xs text-slate-500">
                    {selectedCount > 0
                      ? `เลือกแล้ว ${selectedCount} บรรทัด`
                      : "กรอกจำนวนที่ไม่เป็น 0 อย่างน้อย 1 บรรทัด"}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={closeMatrix}
                    >
                      ยกเลิก
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={selectedCount === 0 || isMatrixPending}
                      className="gap-1.5"
                      onClick={handleAddLines}
                    >
                      <Plus className="size-3.5" />
                      เพิ่มรายการ
                    </Button>
                  </div>
                </div>
              </>
            ) : matrix && matrix.skus.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-8 text-center text-sm text-slate-500">
                ไม่พบ SKU ภายใต้รุ่นนี้
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
