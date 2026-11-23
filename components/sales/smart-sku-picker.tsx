"use client";

/**
 * Smart SKU Picker — product search via Server Action only.
 *
 * Zero Client-Side Fetching: debounced `searchProductsForSales` (Service Role).
 */

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  useTransition,
} from "react";
import { ChevronsUpDown, Loader2, PackageSearch } from "lucide-react";
import {
  searchProductsForSales,
} from "@/lib/actions/document-actions";
import { getSmartSkuPickerAllProducts } from "@/lib/actions/manual-receipt-context";
import type { SalesProductSearchItem } from "@/types/document";
import type { VendorMappedReceiptProduct } from "@/types/manual-receipt";
import { matchesSmartSkuSearch } from "@/lib/utils/smart-sku-search";
import { normalizePurchaseTaxMode } from "@/lib/utils/purchase-tax";
import { cn } from "@/lib/utils";
import { LineItemProductThumb } from "@/components/sales/LineItemProductThumb";
import { Badge } from "@/components/ui/badge";
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

export type SmartSkuPickerMode = "sales" | "purchases";

export type SmartSkuPickerProps = {
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  /** `sales` excludes raw materials; `purchases` includes raw materials + FG, excludes services. */
  mode?: SmartSkuPickerMode;
  /** Fires with the full product payload (incl. cost_price) when user picks a row. */
  onSelectProduct: (product: SalesProductSearchItem) => void;
  /** Mapped SKUs for the selected vendor — shown first in purchases mode. */
  vendorCatalog?: VendorMappedReceiptProduct[];
};

export type SmartSkuPickerHandle = {
  openAndFocus: () => void;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function money2(value: number): string {
  return (Number.isFinite(value) ? value : 0).toFixed(2);
}

function PurchaseSkuOption({
  product,
}: {
  product: SalesProductSearchItem & { vendor_sku?: string | null };
}) {
  const sku = product.sku.trim();
  const vendorSku = (product.vendor_sku ?? "").trim();
  const hasDistinctVendorSku = Boolean(
    vendorSku && vendorSku.toUpperCase() !== sku.toUpperCase(),
  );
  const tax = normalizePurchaseTaxMode(product.tax_type);
  const net = Number(product.base_net_cost_ex_vat ?? product.cost_price) || 0;
  const remembered = Number(product.last_invoice_unit_price);
  const inclusive =
    tax === "INC_VAT" && Number.isFinite(remembered) && remembered > 0
      ? remembered
      : Number(product.base_inc_vat_price) > 0
        ? Number(product.base_inc_vat_price)
        : net;
  const uom = product.base_uom?.trim() || "หน่วย";
  const priceLine =
    tax === "INC_VAT"
      ? `ตามบิล ${money2(inclusive)} ฿ (รวม VAT) · ทุนก่อน VAT ${money2(net)} ฿ · ${uom}`
      : tax === "EXC_VAT"
        ? `ตามบิล ${money2(net)} ฿ (ก่อน VAT) · รวม VAT ${money2(inclusive)} ฿ · ${uom}`
        : `ตามบิล ${money2(net)} ฿ (Non-VAT) · ${uom}`;

  return (
    <div className="min-w-0 flex-1">
      <p className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-mono text-xs font-semibold text-slate-900">{sku}</span>
        {tax ? (
          <Badge variant="slate" className="shrink-0 px-1.5 py-0 text-[9px]">
            {tax === "NON_VAT" ? "NONE" : tax}
          </Badge>
        ) : null}
        {hasDistinctVendorSku ? (
          <span className="truncate text-[11px] font-normal text-slate-500">· ผู้ขาย: {vendorSku}</span>
        ) : null}
      </p>
      <p className="truncate text-sm leading-snug text-slate-700">{product.display_name}</p>
      <p className="mt-0.5 truncate text-[11px] text-emerald-700">{priceLine}</p>
    </div>
  );
}

function toSmartSkuSearchItem(
  item: SalesProductSearchItem & { vendor_sku?: string | null },
) {
  return {
    sku: item.sku,
    name: item.display_name,
    product_name: item.model_name ?? item.display_name,
    color: item.color_name,
    size: item.size_label,
    vendor_sku: item.vendor_sku ?? null,
  };
}

const SmartSkuPicker = forwardRef<SmartSkuPickerHandle, SmartSkuPickerProps>(
  function SmartSkuPicker(
    {
      disabled = false,
      className,
      placeholder = "ค้นหา SKU หรือชื่อรุ่น...",
      mode = "sales",
      onSelectProduct,
      vendorCatalog = [],
    },
    ref,
  ) {
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [results, setResults] = useState<SalesProductSearchItem[]>([]);
  const [catalog, setCatalog] = useState<SalesProductSearchItem[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useImperativeHandle(
    ref,
    () => ({
      openAndFocus() {
        if (disabled) return;
        setOpen(true);
        window.setTimeout(() => {
          inputRef.current?.focus();
        }, 30);
      },
    }),
    [disabled],
  );

  const vendorIds = new Set(vendorCatalog.map((item) => item.id));
  const vendorMatches = vendorCatalog
    .filter((item) => matchesSmartSkuSearch(toSmartSkuSearchItem(item), query))
    .slice(0, 100);
  const warehouseMatches =
    mode === "purchases" && query.trim().length > 0
      ? catalog
          .filter(
            (item) =>
              !vendorIds.has(item.id) &&
              matchesSmartSkuSearch(toSmartSkuSearchItem(item), query),
          )
          .slice(0, 100)
      : [];

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
    if (mode !== "purchases") return;
    let active = true;
    startTransition(async () => {
      try {
        const result = await getSmartSkuPickerAllProducts();
        if (!active) return;
        if (result.error) {
          setCatalogError(result.error);
          setCatalog([]);
          return;
        }
        setCatalogError(null);
        setCatalog(Array.isArray(result.data) ? result.data : []);
      } catch (err) {
        if (!active) return;
        setCatalogError(
          err instanceof Error ? err.message : "โหลดสินค้าทั้งคลังไม่สำเร็จ",
        );
        setCatalog([]);
      }
    });
    return () => {
      active = false;
    };
  }, [mode]);

  useEffect(() => {
    if (!open || mode === "purchases") return;

    if (debouncedQuery.length < 1) {
      setResults([]);
      setError(null);
      return;
    }

    let active = true;
    const searchProducts = searchProductsForSales;
    startTransition(async () => {
      try {
        const result = await searchProducts(debouncedQuery);
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
  }, [debouncedQuery, mode, open]);

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

  const visibleError = error || catalogError;
  const salesSearching = mode !== "purchases" && isPending && debouncedQuery.length > 0;
  const catalogLoading =
    mode === "purchases" && isPending && catalog.length === 0 && !catalogError;
  const otherMatches =
    mode === "purchases"
      ? warehouseMatches
      : results.filter((product) => !vendorIds.has(product.id));
  const queryText = query.trim();

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
            className={cn(
              "w-full justify-between font-normal",
              mode === "purchases" ? "h-10" : "h-11",
            )}
          >
            <span className="flex min-w-0 items-center gap-2 text-slate-400">
              <PackageSearch className="size-4 shrink-0 text-blue-600" />
              <span className="truncate">{placeholder}</span>
            </span>
            {isPending && mode !== "purchases" ? (
              <Loader2 className="size-4 shrink-0 animate-spin text-slate-400" />
            ) : (
              <ChevronsUpDown className="size-4 shrink-0 text-slate-400" />
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={6}
          className="z-[9999] w-[var(--radix-popover-trigger-width)] min-w-[340px] p-0"
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
            <CommandList className="max-h-[380px]">
              {visibleError ? (
                <div className="px-3 py-4 text-center text-xs text-red-600">
                  {visibleError}
                </div>
              ) : null}

              {!visibleError && salesSearching ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-slate-400">
                  <Loader2 className="size-3.5 animate-spin" />
                  กำลังค้นหาผ่าน Server Action...
                </div>
              ) : null}

              {!visibleError && catalogLoading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-slate-400">
                  <Loader2 className="size-3.5 animate-spin" />
                  กำลังโหลดสินค้าทั้งคลัง...
                </div>
              ) : null}

              {!visibleError &&
              !salesSearching &&
              !catalogLoading &&
              queryText.length === 0 &&
              vendorMatches.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-slate-400">
                  {vendorCatalog.length > 0
                    ? "ไม่พบสินค้าที่ผูกกับผู้จำหน่ายนี้"
                    : "พิมพ์อย่างน้อย 1 ตัวอักษรเพื่อค้นหา"}
                </div>
              ) : null}

              {!visibleError &&
              !salesSearching &&
              !catalogLoading &&
              (mode === "purchases" ? queryText.length > 0 : debouncedQuery.length > 0) &&
              otherMatches.length === 0 &&
              vendorMatches.length === 0 ? (
                <CommandEmpty>ไม่พบสินค้าที่ตรงกับคำค้น</CommandEmpty>
              ) : null}

              {!visibleError && vendorMatches.length > 0 ? (
                <CommandGroup heading={`สินค้าของผู้จำหน่ายนี้ (${vendorMatches.length})`}>
                  {vendorMatches.map((product) => (
                    <CommandItem
                      key={`vendor-${product.id}-${product.vendor_sku}`}
                      value={`${product.vendor_sku} ${product.sku} ${product.display_name}`}
                      onSelect={() => pickProduct(product)}
                      onMouseDown={(event) => {
                        event.preventDefault();
                        pickProduct(product);
                      }}
                      className="cursor-pointer items-center gap-2 py-2"
                    >
                      <LineItemProductThumb imageUrl={product.image_url} alt={product.sku} />
                      <PurchaseSkuOption product={product} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              ) : null}

              {!visibleError && otherMatches.length > 0 ? (
                <CommandGroup
                  heading={`สินค้าทั้งหมดในคลัง (${otherMatches.length})`}
                >
                  {otherMatches.map((product) => (
                    <CommandItem
                      key={product.id}
                      value={`${product.sku} ${product.display_name}`}
                      onSelect={() => pickProduct(product)}
                      onMouseDown={(event) => {
                        // Keep focus stable; select even if cmdk onSelect is flaky.
                        event.preventDefault();
                        pickProduct(product);
                      }}
                      className="cursor-pointer items-center gap-2 py-2"
                    >
                      <LineItemProductThumb
                        imageUrl={product.image_url}
                        alt={product.sku}
                      />
                      {mode === "purchases" ? (
                        <PurchaseSkuOption product={product} />
                      ) : (
                      <div className="min-w-0 flex-1">
                        <p className="flex min-w-0 items-center gap-1.5 truncate font-mono text-xs font-semibold text-slate-900">
                          <span className="truncate">{product.sku}</span>
                          {product.is_service ? (
                            <Badge
                              variant="amber"
                              className="shrink-0 px-1.5 py-0 text-[9px] uppercase tracking-wide"
                            >
                              Service
                            </Badge>
                          ) : null}
                        </p>
                        <p className="whitespace-normal break-words text-sm leading-snug text-slate-700">
                          {product.display_name}
                        </p>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          ราคา {formatMoney(product.unit_price)} ฿ · ต้นทุน {formatMoney(product.cost_price)} ฿
                          {product.base_uom ? ` · ${product.base_uom}` : ""}
                        </p>
                      </div>
                      )}
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
},
);

export default SmartSkuPicker;
