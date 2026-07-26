"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2 } from "lucide-react";
import { toast } from "sonner";
import {
  calculateNetUnitCost,
  calculateUnitCostPrice,
} from "@/lib/utils/pricing";
import { cn } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  fetchActiveProducts,
  fetchMappingsByNormalizedSkus,
  insertOnTheFlyMapping,
} from "../api";
import { normalizeVendorSku } from "../lib/normalize-vendor-sku";
import type {
  OcrVerificationItem,
  OcrVerificationRow,
  ProductSummary,
  VendorMappingMatch,
} from "../types";
import { ProductCombobox } from "./ProductCombobox";

export type SmartGoodsReceiptOcrItem = Pick<
  OcrVerificationItem,
  "raw_vendor_sku" | "unit_price" | "discount_text"
> &
  Partial<Pick<OcrVerificationItem, "qty" | "raw_description">>;

export type SmartGoodsReceiptTableProps = {
  vendorId: string;
  /** AI-extracted OCR lines from Vision / Gemini */
  items: SmartGoodsReceiptOcrItem[];
  onRowsChange?: (rows: OcrVerificationRow[]) => void;
  /** Show loading overlay while bill OCR is in flight */
  isProcessing?: boolean;
};

function buildLineKey(item: SmartGoodsReceiptOcrItem, index: number): string {
  return `${index}:${item.raw_vendor_sku}:${item.qty ?? 0}:${item.unit_price}:${item.discount_text ?? ""}`;
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function toVerificationItem(item: SmartGoodsReceiptOcrItem): OcrVerificationItem {
  return {
    raw_vendor_sku: item.raw_vendor_sku,
    qty: item.qty ?? 0,
    unit_price: item.unit_price,
    discount_text: item.discount_text ?? "",
    raw_description: item.raw_description,
  };
}

/** Matched = mapping has a usable `internal_product_id` + product payload */
function isMatchedMapping(mapping: VendorMappingMatch | null | undefined): boolean {
  return Boolean(mapping?.internal_product_id && mapping.product);
}

function buildRowFromLookup(
  raw: SmartGoodsReceiptOcrItem,
  index: number,
  mappingBySku: Map<string, VendorMappingMatch>,
): OcrVerificationRow {
  const item = toVerificationItem(raw);
  const normalizedSku = normalizeVendorSku(item.raw_vendor_sku ?? "");
  const mapping = normalizedSku ? mappingBySku.get(normalizedSku) : undefined;
  const product = mapping?.product ?? null;
  const { unitCostPrice, discountAmountPerUnit } = calculateNetUnitCost(
    item.unit_price,
    item.discount_text ?? "",
  );

  if (isMatchedMapping(mapping ?? null) && product) {
    return {
      lineKey: buildLineKey(raw, index),
      item,
      normalizedSku,
      status: "ready",
      mapping: mapping!,
      product,
      unitCostPrice,
      discountAmountPerUnit,
    };
  }

  return {
    lineKey: buildLineKey(raw, index),
    item,
    normalizedSku,
    status: "action_required",
    mapping: null,
    product: null,
    unitCostPrice,
    discountAmountPerUnit,
  };
}

function StatusBadge({ status }: { status: OcrVerificationRow["status"] }) {
  if (status === "looking_up") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
        Looking up…
      </span>
    );
  }

  if (status === "ready") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <CheckCircle2 className="size-3" aria-hidden />
        Ready
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700">
      <AlertTriangle className="size-3" aria-hidden />
      Unmatched
    </span>
  );
}

/**
 * Phase 3 — Smart Goods Receipt verification table (shadcn/ui).
 *
 * - Accepts AI OCR lines: `raw_vendor_sku`, `unit_price`, `discount_text`
 * - Computes dynamic `unit_cost_price` via {@link calculateUnitCostPrice}
 * - Unmatched SKUs (no `internal_product_id`) → red alert row + Smart Combobox
 *   for on-the-fly `vendor_product_mapping` insert
 */
export default function SmartGoodsReceiptTable({
  vendorId,
  items,
  onRowsChange,
  isProcessing = false,
}: SmartGoodsReceiptTableProps) {
  const [rows, setRows] = useState<OcrVerificationRow[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [mappingLineKey, setMappingLineKey] = useState<string | null>(null);

  const stats = useMemo(() => {
    const ready = rows.filter((row) => row.status === "ready").length;
    const unmatched = rows.filter(
      (row) => row.status === "action_required",
    ).length;
    return { total: rows.length, ready, unmatched };
  }, [rows]);

  const runLookup = useCallback(async () => {
    if (!vendorId || items.length === 0) {
      setRows([]);
      setLookupError("");
      onRowsChange?.([]);
      return;
    }

    setIsLoading(true);
    setLookupError("");

    const normalizedSkus = items.map((item) =>
      normalizeVendorSku(item.raw_vendor_sku ?? ""),
    );

    const [mappingsResult, productsResult] = await Promise.all([
      fetchMappingsByNormalizedSkus(vendorId, normalizedSkus),
      products.length > 0
        ? Promise.resolve({ data: products, error: null as string | null })
        : fetchActiveProducts(),
    ]);

    if (productsResult.error) {
      toast.error(`โหลดสินค้าไม่สำเร็จ: ${productsResult.error}`);
    } else if (products.length === 0) {
      setProducts(productsResult.data);
    }

    if (mappingsResult.error) {
      setRows([]);
      setLookupError(mappingsResult.error);
      toast.error(`จับคู่ OCR ไม่สำเร็จ: ${mappingsResult.error}`);
      onRowsChange?.([]);
      setIsLoading(false);
      return;
    }

    const nextRows = items.map((item, index) =>
      buildRowFromLookup(item, index, mappingsResult.data),
    );
    setRows(nextRows);
    onRowsChange?.(nextRows);
    setIsLoading(false);
  }, [vendorId, items, products, onRowsChange]);

  useEffect(() => {
    void runLookup();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- vendor/items identity drives lookup
  }, [vendorId, items]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await fetchActiveProducts();
      if (cancelled) return;
      if (error) {
        toast.error(`โหลดสินค้าไม่สำเร็จ: ${error}`);
        return;
      }
      setProducts(data);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleOnTheFlyMap(
    row: OcrVerificationRow,
    productId: string,
  ) {
    if (mappingLineKey || !vendorId) return;

    const product = products.find((item) => item.id === productId);
    if (!product) {
      toast.error("ไม่พบสินค้าที่เลือก");
      return;
    }
    if (!row.normalizedSku) {
      toast.error("รหัส OCR ว่าง — ไม่สามารถสร้าง mapping ได้");
      return;
    }

    setMappingLineKey(row.lineKey);
    setRows((current) =>
      current.map((item) =>
        item.lineKey === row.lineKey
          ? { ...item, status: "looking_up" as const }
          : item,
      ),
    );

    const { data, error, code } = await insertOnTheFlyMapping({
      vendorId,
      vendorSku: row.normalizedSku,
      vendorProductName: row.item.raw_description || product.name,
      internalProductId: productId,
    });

    if (error || !data?.product || !data.internal_product_id) {
      if (code === "23505") {
        toast.message(error ?? "รหัสนี้ถูกผูกไว้แล้ว — กำลังโหลด mapping ใหม่");
        setMappingLineKey(null);
        await runLookup();
        return;
      }

      toast.error(error ?? "บันทึก mapping ไม่สำเร็จ");
      setRows((current) =>
        current.map((item) =>
          item.lineKey === row.lineKey
            ? { ...item, status: "action_required" as const }
            : item,
        ),
      );
      setMappingLineKey(null);
      return;
    }

    setRows((current) => {
      const next = current.map((item) => {
        if (item.lineKey !== row.lineKey) return item;
        return {
          ...item,
          status: "ready" as const,
          mapping: data,
          product: data.product,
          unitCostPrice: calculateUnitCostPrice(
            item.item.unit_price,
            item.item.discount_text,
          ),
        };
      });
      onRowsChange?.(next);
      return next;
    });

    toast.success(
      `On-the-fly: ${row.normalizedSku} ↔ ${data.product.sku}`,
    );
    setMappingLineKey(null);
  }

  if (!vendorId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-400">
          เลือกผู้จำหน่ายก่อน เพื่อเริ่ม Smart Goods Receipt
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-400">
          ยังไม่มีข้อมูล OCR — ส่ง array ของ{" "}
          <code className="text-xs">raw_vendor_sku / unit_price / discount_text</code>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="relative space-y-4">
      {isProcessing ? (
        <div
          role="status"
          aria-live="polite"
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-2xl bg-white/80 backdrop-blur-[2px]"
        >
          <div className="size-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          <p className="text-sm font-semibold text-slate-700">
            กำลังอ่านบิลด้วย AI…
          </p>
          <p className="text-[11px] text-slate-400">
            POST → process-receipt-ocr · รอผล JSON เพื่อแสดงในตาราง
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <div className="rounded-xl bg-slate-50 px-4 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            OCR Lines
          </p>
          <p className="mt-0.5 text-lg font-bold text-slate-800">
            {stats.total.toLocaleString("th-TH")}
          </p>
        </div>
        <div className="rounded-xl bg-emerald-50 px-4 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
            Matched
          </p>
          <p className="mt-0.5 text-lg font-bold text-emerald-700">
            {stats.ready.toLocaleString("th-TH")}
          </p>
        </div>
        <div className="rounded-xl bg-red-50 px-4 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-red-600">
            Unmatched
          </p>
          <p className="mt-0.5 text-lg font-bold text-red-700">
            {stats.unmatched.toLocaleString("th-TH")}
          </p>
        </div>
        {isLoading && (
          <div className="flex items-center text-xs text-slate-400">
            กำลังจับคู่กับ vendor_product_mapping...
          </div>
        )}
      </div>

      {lookupError ? (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {lookupError}
        </div>
      ) : null}

      {stats.unmatched > 0 ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            พบ{" "}
            <strong>{stats.unmatched.toLocaleString("th-TH")}</strong>{" "}
            รายการที่ยังไม่มี{" "}
            <code className="rounded bg-red-100 px-1 text-xs">
              internal_product_id
            </code>{" "}
            — เลือกสินค้าภายในจาก Smart Combobox เพื่อสร้าง mapping ทันที
          </p>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardHeader>
          <CardTitle>Smart Goods Receipt — OCR Verification</CardTitle>
          <CardDescription>
            คำนวณ{" "}
            <code className="text-xs">unit_cost_price</code> จาก{" "}
            <code className="text-xs">unit_price</code> +{" "}
            <code className="text-xs">discount_text</code> · Unmatched → On-the-fly
            mapping
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <Table className="min-w-[1020px]">
            <TableHeader>
              <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                <TableHead>สถานะ</TableHead>
                <TableHead>raw_vendor_sku</TableHead>
                <TableHead>สินค้าภายใน</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">unit_price</TableHead>
                <TableHead>discount_text</TableHead>
                <TableHead className="text-right">unit_cost_price</TableHead>
                <TableHead className="min-w-[240px]">On-the-fly Mapping</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const unmatched =
                  row.status === "action_required" ||
                  !row.mapping?.internal_product_id;
                const isReady = row.status === "ready" && !unmatched;
                const isBusy = mappingLineKey === row.lineKey;
                const unitCostPrice = calculateUnitCostPrice(
                  row.item.unit_price,
                  row.item.discount_text,
                );

                return (
                  <TableRow
                    key={row.lineKey}
                    className={cn(
                      isReady && "bg-emerald-50/50",
                      unmatched &&
                        "border-l-4 border-l-red-500 bg-red-50/70 hover:bg-red-50",
                    )}
                  >
                    <TableCell>
                      <StatusBadge
                        status={isBusy ? "looking_up" : row.status}
                      />
                    </TableCell>
                    <TableCell>
                      <p
                        className={cn(
                          "font-mono text-xs font-semibold",
                          unmatched ? "text-red-800" : "text-slate-800",
                        )}
                      >
                        {row.normalizedSku || "—"}
                      </p>
                      {row.item.raw_description ? (
                        <p className="mt-0.5 max-w-[180px] truncate text-[11px] text-slate-400">
                          {row.item.raw_description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      {row.product ? (
                        <div>
                          <p className="font-mono text-xs font-semibold text-blue-700">
                            {row.product.sku}
                          </p>
                          <p className="text-sm text-slate-700">
                            {row.product.name}
                          </p>
                          <p className="text-[11px] text-slate-400">
                            {[row.product.color, row.product.size]
                              .filter(Boolean)
                              .join(" · ") || "—"}
                          </p>
                        </div>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-red-600">
                          <AlertTriangle className="size-3" aria-hidden />
                          ไม่มี internal_product_id
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {(row.item.qty ?? 0).toLocaleString("th-TH")}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.item.unit_price)}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {row.item.discount_text?.trim() || "—"}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-semibold tabular-nums",
                        unmatched ? "text-red-800" : "text-slate-800",
                      )}
                    >
                      {formatMoney(unitCostPrice)}
                    </TableCell>
                    <TableCell>
                      {isReady ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                          <Link2 className="size-3" aria-hidden />
                          พร้อมรับของ
                        </span>
                      ) : (
                        <div className="space-y-1.5">
                          <div
                            role="alert"
                            className="rounded-lg border border-red-200 bg-red-100/80 px-2 py-1 text-[10px] font-semibold text-red-700"
                          >
                            Unmatched — เลือกสินค้าเพื่อจับคู่ทันที
                          </div>
                          <ProductCombobox
                            products={products}
                            value=""
                            disabled={
                              isBusy || !row.normalizedSku || isLoading
                            }
                            onChange={(productId) =>
                              void handleOnTheFlyMap(row, productId)
                            }
                            placeholder={
                              isBusy
                                ? "กำลังบันทึก mapping..."
                                : "Smart Combobox — ค้นหา SKU ภายใน..."
                            }
                          />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
