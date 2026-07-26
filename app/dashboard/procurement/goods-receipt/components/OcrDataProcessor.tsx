"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  fetchActiveProducts,
  fetchMappingsByNormalizedSkus,
  insertOnTheFlyMapping,
} from "../api";
import { normalizeVendorSku } from "../lib/normalize-vendor-sku";
import type {
  MatchedOcrLine,
  OcrLineItem,
  OcrMatchResult,
  ProductSummary,
  UnmatchedOcrLine,
  VendorMappingMatch,
} from "../types";
import { ActionRequiredList } from "./ActionRequiredList";
import { ReadyToReceiveTable } from "./ReadyToReceiveTable";

export interface OcrDataProcessorProps {
  vendorId: string;
  ocrItems: OcrLineItem[];
  /** Optional: notify parent when match state changes */
  onMatchResultChange?: (result: OcrMatchResult) => void;
}

function buildLineKey(item: OcrLineItem, index: number): string {
  return `${index}:${item.raw_code}:${item.raw_description}:${item.qty}:${item.unit_price}`;
}

function partitionOcrItems(
  ocrItems: OcrLineItem[],
  mappingBySku: Map<string, VendorMappingMatch>,
): OcrMatchResult {
  const matched: MatchedOcrLine[] = [];
  const unmatched: UnmatchedOcrLine[] = [];

  ocrItems.forEach((ocr, index) => {
    const normalizedSku = normalizeVendorSku(ocr.raw_code ?? "");
    const lineKey = buildLineKey(ocr, index);
    const mapping = normalizedSku
      ? mappingBySku.get(normalizedSku)
      : undefined;

    if (mapping?.product) {
      matched.push({
        lineKey,
        ocr,
        normalizedSku,
        mapping,
        product: mapping.product,
      });
      return;
    }

    unmatched.push({
      lineKey,
      ocr,
      normalizedSku,
    });
  });

  return { matched, unmatched };
}

/**
 * Smart OCR Matcher — maps Vision AI invoice lines to internal products
 * via vendor_product_mapping (vendor_sku ↔ internal_product_id).
 */
export default function OcrDataProcessor({
  vendorId,
  ocrItems,
  onMatchResultChange,
}: OcrDataProcessorProps) {
  const [matched, setMatched] = useState<MatchedOcrLine[]>([]);
  const [unmatched, setUnmatched] = useState<UnmatchedOcrLine[]>([]);
  const [products, setProducts] = useState<ProductSummary[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processError, setProcessError] = useState("");
  const [mappingLineKey, setMappingLineKey] = useState<string | null>(null);

  const onMatchResultChangeRef = useRef(onMatchResultChange);
  useEffect(() => {
    onMatchResultChangeRef.current = onMatchResultChange;
  }, [onMatchResultChange]);

  const stats = useMemo(
    () => ({
      total: ocrItems.length,
      ready: matched.length,
      action: unmatched.length,
    }),
    [ocrItems.length, matched.length, unmatched.length],
  );

  // Load product catalog once (for Action Required combobox)
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

  // Match OCR lines whenever vendor or payload changes
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      if (!vendorId || ocrItems.length === 0) {
        setMatched([]);
        setUnmatched([]);
        setProcessError("");
        onMatchResultChangeRef.current?.({ matched: [], unmatched: [] });
        return;
      }

      setIsProcessing(true);
      setProcessError("");

      const normalizedSkus = ocrItems.map((item) =>
        normalizeVendorSku(item.raw_code ?? ""),
      );

      const { data: mappingBySku, error } =
        await fetchMappingsByNormalizedSkus(vendorId, normalizedSkus);

      if (cancelled) return;

      if (error) {
        setMatched([]);
        setUnmatched([]);
        setProcessError(error);
        toast.error(`จับคู่ OCR ไม่สำเร็จ: ${error}`);
        onMatchResultChangeRef.current?.({ matched: [], unmatched: [] });
        setIsProcessing(false);
        return;
      }

      const result = partitionOcrItems(ocrItems, mappingBySku);
      setMatched(result.matched);
      setUnmatched(result.unmatched);
      onMatchResultChangeRef.current?.(result);
      setIsProcessing(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [vendorId, ocrItems]);

  const handleMapProduct = useCallback(
    async (line: UnmatchedOcrLine, productId: string) => {
      if (mappingLineKey || !vendorId) return;

      const product = products.find((item) => item.id === productId);
      if (!product) {
        toast.error("ไม่พบสินค้าที่เลือก");
        return;
      }
      if (!line.normalizedSku) {
        toast.error("รหัส OCR ว่าง — ไม่สามารถสร้าง mapping ได้");
        return;
      }

      setMappingLineKey(line.lineKey);

      const { data, error } = await insertOnTheFlyMapping({
        vendorId,
        vendorSku: line.normalizedSku,
        vendorProductName: line.ocr.raw_description || product.name,
        internalProductId: productId,
      });

      if (error || !data?.product) {
        toast.error(error ?? "บันทึก mapping ไม่สำเร็จ");
        setMappingLineKey(null);
        return;
      }

      const nextMatchedLine: MatchedOcrLine = {
        lineKey: line.lineKey,
        ocr: line.ocr,
        normalizedSku: line.normalizedSku,
        mapping: data,
        product: data.product,
      };

      setMatched((prevMatched) => {
        const nextMatched = [...prevMatched, nextMatchedLine];
        setUnmatched((prevUnmatched) => {
          const nextUnmatched = prevUnmatched.filter(
            (item) => item.lineKey !== line.lineKey,
          );
          onMatchResultChangeRef.current?.({
            matched: nextMatched,
            unmatched: nextUnmatched,
          });
          return nextUnmatched;
        });
        return nextMatched;
      });

      toast.success(
        `จับคู่ ${line.normalizedSku} ↔ ${data.product.sku} แล้ว — ย้ายไป Ready to Receive`,
      );
      setMappingLineKey(null);
    },
    [mappingLineKey, vendorId, products],
  );

  if (!vendorId) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-400">
          เลือกผู้จำหน่ายก่อน เพื่อเริ่ม Smart OCR Matcher
        </CardContent>
      </Card>
    );
  }

  if (ocrItems.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-slate-400">
          ยังไม่มีข้อมูล OCR — วาง JSON จาก Vision AI เพื่อประมวลผล
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
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
            Ready to Receive
          </p>
          <p className="mt-0.5 text-lg font-bold text-emerald-700">
            {stats.ready.toLocaleString("th-TH")}
          </p>
        </div>
        <div className="rounded-xl bg-amber-50 px-4 py-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-600">
            Action Required
          </p>
          <p className="mt-0.5 text-lg font-bold text-amber-700">
            {stats.action.toLocaleString("th-TH")}
          </p>
        </div>
        {isProcessing && (
          <div className="flex items-center text-xs text-slate-400">
            กำลังจับคู่กับ vendor_product_mapping...
          </div>
        )}
      </div>

      {processError && (
        <div
          role="alert"
          className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {processError}
        </div>
      )}

      <Card className="overflow-hidden">
        <CardHeader className="bg-emerald-50/40">
          <CardTitle className="text-emerald-800">Ready to Receive</CardTitle>
          <CardDescription>
            รายการที่จับคู่ vendor_sku กับสินค้าภายในสำเร็จแล้ว
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 pb-2">
          <ReadyToReceiveTable rows={matched} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="bg-amber-50/40">
          <CardTitle className="text-amber-800">Action Required</CardTitle>
          <CardDescription>
            รายการที่ยังไม่พบใน vendor_product_mapping — เลือกสินค้าภายในเพื่อสร้าง
            mapping ทันที
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActionRequiredList
            rows={unmatched}
            products={products}
            mappingLineKey={mappingLineKey}
            onMapProduct={(line, productId) => {
              void handleMapProduct(line, productId);
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

export { normalizeVendorSku };
