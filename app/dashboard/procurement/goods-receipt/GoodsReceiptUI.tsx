"use client";

/**
 * Smart Goods Receipt — main client UI.
 *
 * Zero Client-Side Fetching: every read/write goes through Server Actions in
 * `lib/actions/receipt.ts` (and `lib/actions/mapping.ts` for vendors). This
 * component only holds UI state and orchestrates calls — it never talks to
 * Supabase directly.
 *
 * Business logic pivot: `raw_vendor_sku` from OCR is Ground Truth — we do
 * NOT predict/generate vendor SKUs. The employee's only job is to resolve
 * "Unmatched" rows by picking the correct internal product.
 *
 * 1. Header — Vendor Smart Combobox
 * 2. Upload Zone — drag & drop bill → keep raw `File` in state → "Parse with
 *    AI" button builds a `FormData` and triggers `parseReceiptOcr` (real
 *    Google Gemini Vision OCR) + `matchReceiptItemsToProducts`. FormData
 *    avoids passing a giant Base64 string through the Server Action
 *    boundary (which hits Next.js's "Maximum array nesting exceeded"
 *    serialization limit) — the file→Base64 conversion now happens
 *    server-side inside `parseReceiptOcr`.
 * 3. Review Table — OCR raw text ↔ matched internal product; Unmatched rows
 *    get a Smart Combobox + "Confirm Mapping" button that calls
 *    `createOnTheFlyReceiptMapping` and refreshes that row to 'matched'
 * 4. Sticky Summary Footer — Total Qty / Total Value + "Save to Ledger"
 *    button (disabled while any row is 'unmatched'). Calls
 *    `saveGoodsReceiptToLedger`, which is the ONLY path that writes stock
 *    movements (`inventory_ledger`) — `products` stock is never touched
 *    directly, per the ERP blueprint.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  PackageCheck,
  Pencil,
  RefreshCw,
  Sparkles,
  Trash2,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import type { VendorOption } from "@/lib/actions/mapping";
import {
  createOnTheFlyReceiptMapping,
  getInternalProductsForMatching,
  getOcrQuotaStatusAction,
  matchReceiptItemsToProducts,
  parseReceiptOcr,
  rematchSingleOcrLineAction,
  saveGoodsReceiptToLedger,
  type ReceiptLineRow,
  type ReceiptProductSummary,
} from "@/lib/actions/receipt";
import { saveDocumentProcurementBills } from "@/lib/actions/procurement-bills";
import { uploadProcurementBills } from "@/lib/procurement/upload-bill-files";
import { normalizeOcrSkuText } from "@/lib/utils/ocr-sku";
import {
  formatOcrQuotaChip,
  type OcrQuotaStatus,
} from "@/lib/ai/ocr-quota";
import {
  calculateNetCostApportionment,
  roundTo4Decimals,
  type ApportionmentItem,
} from "@/lib/utils/accounting";
import type { GoodsReceiptDocType } from "@/lib/constants/document";
import {
  calculateDocumentSummary,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import VendorCombobox from "@/components/procurement/VendorCombobox";
import InternalProductCombobox from "@/components/procurement/InternalProductCombobox";
import QuickCreateDialog from "@/components/procurement/QuickCreateDialog";
import FullMatrixDialog from "@/components/procurement/FullMatrixDialog";
import SaveToLedgerDialog, {
  type SaveToLedgerConfirmPayload,
} from "./components/SaveToLedgerDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { InvoiceDropzone } from "./components/InvoiceDropzone";
import { calculateLandedCost, resolveFreightExVat } from "@/lib/utils/landed-cost";
import {
  resolveConversionFactor,
  stockBaseQty,
  type PurchaseUomOption,
} from "@/lib/utils/purchase-uom";
import {
  analyzeLineItemsTaxConsensus,
  exVatGoodsAmount,
  minorityTaxModes,
  normalizePurchaseTaxMode,
  purchaseTaxModeHint,
  purchaseTaxModeLabel,
  purchaseTaxModeToVatType,
  vatTypeToPurchaseTaxMode,
  type PurchaseTaxMode,
  type TaxModeSource,
} from "@/lib/utils/purchase-tax";
import {
  MixedTaxConflictBanner,
  TaxModeMismatchBanner,
} from "@/components/procurement/purchase-tax-guardrails";
import {
  computeVendorPayable,
  originFreightLineAmount,
  type FreightTaxMode,
} from "@/lib/utils/dual-freight";
import type { CarrierOption } from "@/types/carrier";
import { DualFreightFields } from "@/components/procurement/DualFreightFields";
import { CarrierFreightSummaryDialog } from "@/components/procurement/CarrierFreightSummaryDialog";
import { Select } from "@/components/ui/select";
import { VendorCalcModeBar } from "@/components/procurement/vendor-calc-mode-bar";
import {
  loadVendorRoundingCalcMode,
  saveVendorRoundingCalcMode,
} from "@/lib/actions/vendor-rounding";
import {
  calculateVendorLineTotals,
  matchVendorCalcMode,
  quoteVendorCalcModes,
  vendorCalcModeLabel,
  vendorCalcSpread,
  type VendorCalcMode,
} from "@/lib/utils/vendor-calc-mode";

function roundMoney2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function parseMoneyInput(raw: string): number {
  const cleaned = raw.replace(/,/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

/** Seed / refresh Total Amount from apportionment (skip manually edited lines). */
function applyPennyToLastLine(rows: ReceiptLineRow[], pennyDelta: number): ReceiptLineRow[] {
  const delta = roundMoney2(pennyDelta);
  if (!delta) return rows;
  const index = [...rows]
    .map((row, rowIndex) => ({ row, rowIndex }))
    .reverse()
    .find((item) => !item.row.isFoc && (Number(item.row.qty) || 0) > 0)?.rowIndex;
  if (index == null) return rows;
  return rows.map((row, rowIndex) => {
    if (rowIndex !== index) return row;
    const total = roundMoney2((Number(row.totalAmount) || 0) + delta);
    const qty = Math.max(0, Number(row.qty) || 0);
    const factor = resolveConversionFactor(row.conversionFactor);
    const baseQty = stockBaseQty(qty, factor);
    return {
      ...row,
      totalAmount: total,
      netCost: baseQty > 0 ? roundMoney2(total / baseQty) : 0,
    };
  });
}

function applyApportionedTotals(
  rows: ReceiptLineRow[],
  billDiscountText: string,
  calcMode: VendorCalcMode = "LINE_2DEC",
  pennyDelta = 0,
): ReceiptLineRow[] {
  const items: ApportionmentItem[] = rows.map((row) => ({
    id: row.lineKey,
    unitPrice: Number(row.unit_price) || 0,
    qty: Math.max(0, Number(row.qty) || 0),
    discountText: row.discount_text,
    isFoc: Boolean(row.isFoc),
  }));
  const byKey = new Map(
    calculateNetCostApportionment(items, billDiscountText || null).map((r) => [
      r.id,
      r,
    ]),
  );

  const seeded = rows.map((row) => {
    if (row.isFoc) {
      return { ...row, totalAmount: 0, netCost: 0 };
    }
    const qty = Math.max(0, Number(row.qty) || 0);
    const factor = resolveConversionFactor(row.conversionFactor);
    const baseQty = stockBaseQty(qty, factor);
    if (row.totalAmountManual) {
      const total = roundMoney2(Number(row.totalAmount) || 0);
      return {
        ...row,
        totalAmount: total,
        netCost: baseQty > 0 ? roundMoney2(total / baseQty) : 0,
      };
    }
    const preview = byKey.get(row.lineKey);
    const total = roundMoney2(
      Number(preview?.finalLineTotal ?? row.totalAmount) || 0,
    );
    return {
      ...row,
      totalAmount: total,
      netCost: baseQty > 0 ? roundMoney2(total / baseQty) : 0,
    };
  });

  if (calcMode === "LINE_2DEC" && !pennyDelta) return seeded;

  const adjusted = new Map(
    calculateVendorLineTotals(
      rows.map((row) => ({
        id: row.lineKey,
        unitPrice: Number(row.unit_price) || 0,
        qty: Math.max(0, Number(row.qty) || 0),
        discountText: row.discount_text,
        isFoc: Boolean(row.isFoc),
      })),
      billDiscountText,
      calcMode,
    ).map((line) => [line.id, line.lineTotal]),
  );

  const priced = seeded.map((row) => {
    if (row.isFoc || row.totalAmountManual || calcMode === "LINE_2DEC") return row;
    const total = adjusted.get(row.lineKey);
    if (total == null) return row;
    const qty = Math.max(0, Number(row.qty) || 0);
    const factor = resolveConversionFactor(row.conversionFactor);
    const baseQty = stockBaseQty(qty, factor);
    return {
      ...row,
      totalAmount: total,
      netCost: baseQty > 0 ? roundMoney2(total / baseQty) : 0,
    };
  });
  return applyPennyToLastLine(priced, pennyDelta);
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const VAT_MONEY_INPUT_CLASS =
  "h-auto w-full min-w-[115px] px-2.5 py-1.5 text-right font-mono text-base font-semibold tabular-nums";

function VerificationRow({
  label,
  amount,
  strong = false,
}: {
  label: string;
  amount: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-start justify-between gap-3 py-1 text-sm",
        strong && "mt-1 border-t border-slate-200 pt-2 font-semibold text-slate-900",
      )}
    >
      <span className={strong ? "text-slate-900" : "text-slate-600"}>{label}</span>
      <span className="shrink-0 font-mono tabular-nums">{amount}</span>
    </div>
  );
}

function StatusBadge({
  status,
  matchTier,
}: {
  status: ReceiptLineRow["status"];
  matchTier?: ReceiptLineRow["matchTier"];
}) {
  if (status === "matched" && matchTier === "FUZZY") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
        <AlertTriangle className="size-3" aria-hidden />
        Fuzzy Matched - โปรดตรวจสี/ไซส์
      </span>
    );
  }
  if (status === "matched") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
        <CheckCircle2 className="size-3" aria-hidden />
        Matched
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
      <AlertTriangle className="size-3" aria-hidden />
      Unmatched
    </span>
  );
}

export type GoodsReceiptUIProps = {
  /** Loaded on the server via getActiveVendors() — contacts.contact_roles @> ['Vendor'] */
  initialVendors: VendorOption[];
  initialVendorsError: string | null;
  purchaseUoms: PurchaseUomOption[];
  initialCarriers: CarrierOption[];
};

export default function GoodsReceiptUI({
  initialVendors,
  initialVendorsError,
  purchaseUoms,
  initialCarriers,
}: GoodsReceiptUIProps) {
  const router = useRouter();
  /* Header — vendor (prefetched server-side; no client-side contacts query) */
  const vendors = initialVendors;
  const vendorsError = initialVendorsError;
  const [vendorId, setVendorId] = useState("");

  /* Products for the on-the-fly Smart Combobox (Server Action, not client fetch) */
  const [products, setProducts] = useState<ReceiptProductSummary[]>([]);

  /* Upload zone */
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [fileName, setFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);

  /** Document/invoice number Gemini extracted from the receipt header (editable at Save time). */
  const [ocrDocNumber, setOcrDocNumber] = useState("");
  /** Document/invoice date Gemini extracted from the receipt header (ISO `YYYY-MM-DD`, editable at Save time). */
  const [ocrDocDate, setOcrDocDate] = useState("");
  /** AI-classified document type — seeds Save to Ledger dropdown (human can override). */
  const [aiDocType, setAiDocType] = useState<GoodsReceiptDocType>("AP_TAX");
  /** AI-classified VAT type — seeds Save to Ledger (human or product master can override). */
  const [aiVatType, setAiVatType] = useState<VatCalculationType>("NONE");
  const [taxModeSource, setTaxModeSource] = useState<TaxModeSource>("ai");
  const [mixedTaxConfirmed, setMixedTaxConfirmed] = useState(false);
  /** User typed VAT Amount — keep that figure instead of the automatic 7%. */
  const [vatAmountTouched, setVatAmountTouched] = useState(false);
  /** User edited Grand Total away from the formula (rounding). */
  const [grandTouched, setGrandTouched] = useState(false);

  /** End-of-bill discount text (e.g. "40%", "1500") — fed into calculateNetCostApportionment. */
  const [billDiscountText, setBillDiscountText] = useState("");
  const [calcMode, setCalcMode] = useState<VendorCalcMode>("LINE_2DEC");
  const [pennyDelta, setPennyDelta] = useState(0);
  const [roundingGap, setRoundingGap] = useState(0);
  const [paperSubtotal, setPaperSubtotal] = useState<number | null>(null);
  const [paperGrand, setPaperGrand] = useState<number | null>(null);
  const [netBeforeTouched, setNetBeforeTouched] = useState(false);

  /** ค่าขนส่งต้นทาง (ผู้ขายเรียกเก็บ) */
  const [freightCostInput, setFreightCostInput] = useState("");
  const [freightTaxMode, setFreightTaxMode] = useState<FreightTaxMode>("INCLUDED_IN_TAX");
  const [destFreightInput, setDestFreightInput] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [carrierTrackingNo, setCarrierTrackingNo] = useState("");
  const [carriers, setCarriers] = useState<CarrierOption[]>(initialCarriers);
  const [freightSummaryOpen, setFreightSummaryOpen] = useState(false);
  const [ocrQuota, setOcrQuota] = useState<OcrQuotaStatus | null>(null);

  /** AI VAT Analysis — controlled amounts (auto from lines until user overrides). */
  const [netBeforeVatInput, setNetBeforeVatInput] = useState("");
  const [vatAmountInput, setVatAmountInput] = useState("");
  const [grandTotalInput, setGrandTotalInput] = useState("");
  const [vatTotalsManual, setVatTotalsManual] = useState(false);

  /** "Save to Ledger" confirmation dialog — final review + Early Warning duplicate check. */
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);

  /* Review table */
  const [rows, setRows] = useState<ReceiptLineRow[]>([]);
  const [draftProductByLineKey, setDraftProductByLineKey] = useState<
    Record<string, string>
  >({});
  const [editingRawKey, setEditingRawKey] = useState<string | null>(null);
  const [rawDraft, setRawDraft] = useState("");
  const [rematchingKey, setRematchingKey] = useState<string | null>(null);
  const [overrideLineKey, setOverrideLineKey] = useState<string | null>(null);
  const [confirmingLineKey, setConfirmingLineKey] = useState<string | null>(
    null,
  );

  /* Save to Ledger — finalizes the receipt (doc_headers/doc_details + inventory_ledger) */
  const [isSavingToLedger, setIsSavingToLedger] = useState(false);

  /* Quick Create Product Dialog — which row (if any) is currently creating a product */
  const [quickCreateTarget, setQuickCreateTarget] = useState<ReceiptLineRow | null>(
    null,
  );

  /* Full Matrix (link-out) Dialog — which row (if any) triggered "➕ Full Matrix" */
  const [fullMatrixTarget, setFullMatrixTarget] = useState<ReceiptLineRow | null>(
    null,
  );

  useEffect(() => {
    if (initialVendorsError) {
      toast.error(initialVendorsError);
    }
  }, [initialVendorsError]);

  /** Re-fetches the internal product cache — also used after Quick Create so the new SKU is selectable everywhere. */
  const refreshInternalProducts = useCallback(async () => {
    const result = await getInternalProductsForMatching();
    if (result.error) {
      toast.error(`โหลดรายการสินค้าไม่สำเร็จ: ${result.error}`);
      return;
    }
    setProducts(result.data);
  }, []);

  useEffect(() => {
    void refreshInternalProducts();
  }, [refreshInternalProducts]);

  const refreshOcrQuota = useCallback(async () => {
    const result = await getOcrQuotaStatusAction();
    setOcrQuota(result);
  }, []);

  useEffect(() => {
    void refreshOcrQuota();
  }, [refreshOcrQuota]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleVendorChange(nextId: string) {
    setVendorId(nextId);
    setCalcMode("LINE_2DEC");
    setPennyDelta(0);
    setRoundingGap(0);
    // Mapping differs per vendor — clear stale review rows
    setRows([]);
    setDraftProductByLineKey({});
    if (!nextId) return;
    void loadVendorRoundingCalcMode(nextId).then((result) => {
      if (!result.error) setCalcMode(result.mode);
    });
  }

  const clearInvoice = useCallback(() => {
    setPendingFiles([]);
    setFileName("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRows([]);
    setDraftProductByLineKey({});
    setOcrDocNumber("");
    setOcrDocDate("");
    setAiDocType("AP_TAX");
    setAiVatType("NONE");
    setTaxModeSource("ai");
    setVatAmountTouched(false);
    setGrandTouched(false);
    setBillDiscountText("");
    setPennyDelta(0);
    setRoundingGap(0);
    setPaperSubtotal(null);
    setPaperGrand(null);
    setNetBeforeTouched(false);
    setFreightCostInput("");
    setFreightTaxMode("INCLUDED_IN_TAX");
    setDestFreightInput("");
    setCarrierId("");
    setCarrierTrackingNo("");
    setNetBeforeVatInput("");
    setVatAmountInput("");
    setGrandTotalInput("");
    setVatTotalsManual(false);
  }, [previewUrl]);

  /**
   * Drop/select a file — just stores the raw `File` in state + a local
   * preview URL. No Base64 conversion, no network call — `parseReceiptOcr`
   * receives the `File` itself via `FormData` (see `handleRunOcr`).
   */
  const handleFilesSelected = useCallback(
    (files: File[]) => {
      setRows([]);
      setDraftProductByLineKey({});
      setOcrDocNumber("");
      setOcrDocDate("");
      setAiDocType("AP_TAX");
      setAiVatType("NONE");
      setTaxModeSource("ai");
      setVatAmountTouched(false);
      setGrandTouched(false);
      setBillDiscountText("");
      setFreightCostInput("");
      setFreightTaxMode("INCLUDED_IN_TAX");
      setDestFreightInput("");
      setCarrierId("");
      setCarrierTrackingNo("");
      setVatTotalsManual(false);
      setNetBeforeVatInput("");
      setVatAmountInput("");
      setGrandTotalInput("");
      setFileName(
        files.length === 1
          ? files[0].name
          : `${files.length} หน้า · ${files.map((file) => file.name).join(", ")}`,
      );
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const firstImage = files.find((file) => file.type.startsWith("image/"));
      setPreviewUrl(firstImage ? URL.createObjectURL(firstImage) : null);
      setPendingFiles(files);
    },
    [previewUrl],
  );

  /** Explicit "Parse with AI" trigger — Step 1 (Gemini OCR) + Step 2 (match). */
  async function handleRunOcr() {
    if (!vendorId) {
      toast.error("เลือกผู้จำหน่าย (Vendor) ก่อนวิเคราะห์บิล");
      return;
    }
    if (pendingFiles.length === 0) {
      toast.error("กรุณาอัปโหลดรูปบิลก่อน");
      return;
    }

    setIsOcrRunning(true);
    try {
      // FormData (not a Base64 string) avoids the Server Action
      // "Maximum array nesting exceeded" error for large payloads —
      // Next.js streams `File`/`FormData` natively instead of serializing
      // it through the Flight protocol like a plain string/array.
      const formData = new FormData();
      formData.append("vendorId", vendorId);
      for (const file of pendingFiles) {
        formData.append("file", file);
      }

      const parsed = await parseReceiptOcr(formData);
      if (parsed.error) {
        toast.error(parsed.error);
        setRows([]);
        return;
      }

      setOcrDocNumber(parsed.documentNumber ?? "");
      setOcrDocDate(parsed.documentDate ?? "");
      setAiDocType(parsed.docType);

      const matched = await matchReceiptItemsToProducts(vendorId, parsed.data);
      if (matched.error) {
        toast.error(matched.error);
        setRows([]);
        return;
      }

      if (parsed.modelNotice) {
        toast.warning(parsed.modelNotice);
      }

      const quoteLines = matched.data.map((row) => ({
        id: row.lineKey,
        unitPrice: Number(row.unit_price) || 0,
        qty: Math.max(0, Number(row.qty) || 0),
        discountText: row.discount_text,
        isFoc: Boolean(row.isFoc),
      }));
      const quoteVat =
        parsed.vatType === "INCLUSIVE" || parsed.vatType === "EXCLUSIVE"
          ? parsed.vatType
          : "NONE";
      const quotes = quoteVendorCalcModes(quoteLines, "", quoteVat);
      const nextCalcMode = matchVendorCalcMode({
        preferred: calcMode,
        quotes,
        paperSubtotal: parsed.subtotal,
        paperGrand: parsed.grandTotal,
        freight: parsed.freightCost,
      });
      setCalcMode(nextCalcMode);
      setPaperSubtotal(parsed.subtotal);
      setPaperGrand(parsed.grandTotal);
      setPennyDelta(0);
      setRoundingGap(0);
      const reviewRows = applyApportionedTotals(matched.data, "", nextCalcMode, 0);
      if (nextCalcMode !== calcMode) {
        toast.message(`สลับวิธีคิดเป็น${vendorCalcModeLabel(nextCalcMode)} ให้ตรงกับยอดบนกระดาษ`);
      }
      const consensus = analyzeLineItemsTaxConsensus(
        reviewRows.map((row, index) => ({
          lineNo: index + 1,
          taxType: row.status === "matched" ? row.matchedProduct?.tax_type : null,
          matched: row.status === "matched",
        })),
      );
      const nextVatType =
        consensus.hasUnanimousConsensus && consensus.consensusTaxType
          ? purchaseTaxModeToVatType(consensus.consensusTaxType)
          : parsed.vatType;
      setAiVatType(nextVatType);
      setTaxModeSource(
        consensus.hasUnanimousConsensus ? "product" : "ai",
      );
      setMixedTaxConfirmed(false);
      setVatAmountTouched(false);
      setGrandTouched(false);
      setRows(reviewRows);
      if ((parsed.freightCost ?? 0) > 0) {
        setFreightCostInput((current) => {
          const next = roundMoney2(
            parseMoneyInput(current) + (parsed.freightCost ?? 0),
          );
          return next > 0 ? next.toFixed(2) : "";
        });
      }
      setBillDiscountText("");
      setVatTotalsManual(false);
      setDraftProductByLineKey({});
      const unmatchedCount = matched.data.filter(
        (row) => row.status === "unmatched",
      ).length;
      const docNumberSuffix = parsed.documentNumber
        ? ` — เลขที่เอกสาร: ${parsed.documentNumber}`
        : "";
      const docDateSuffix = parsed.documentDate
        ? ` ลงวันที่ ${parsed.documentDate}`
        : "";
      const typeSuffix = ` · ${parsed.docType} / VAT ${nextVatType}`;
      toast.success(
        (unmatchedCount > 0
          ? `AI วิเคราะห์สำเร็จ — พบ ${matched.data.length} รายการ (${unmatchedCount} ยังไม่จับคู่)`
          : `AI วิเคราะห์สำเร็จ — พบ ${matched.data.length} รายการ จับคู่ครบ`) +
          docNumberSuffix +
          docDateSuffix +
          typeSuffix,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "วิเคราะห์บิลไม่สำเร็จ");
    } finally {
      setIsOcrRunning(false);
      void refreshOcrQuota();
    }
  }

  function handleDraftProductChange(lineKey: string, productId: string) {
    setDraftProductByLineKey((current) => ({ ...current, [lineKey]: productId }));
  }

  /** "Clear" — reverts a row's local draft selection back to a blank Unmatched state. */
  function handleClearDraft(lineKey: string) {
    setDraftProductByLineKey((current) => {
      const next = { ...current };
      delete next[lineKey];
      return next;
    });
  }

  /**
   * Duplicate Internal SKU Guardrail — maps every internal product already
   * selected in THIS receipt (either confirmed `matched` rows or in-progress
   * drafts) to the `raw_vendor_sku` that claimed it. Used to hide that
   * product from every OTHER row's combobox, so the same internal SKU can't
   * accidentally get mapped to two different vendor codes on one document.
   */
  const usedProductIdToVendorSku = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of rows) {
      if (row.status === "matched" && row.matchedProduct) {
        map.set(row.matchedProduct.id, row.raw_vendor_sku);
      }
    }
    for (const row of rows) {
      const draftProductId = draftProductByLineKey[row.lineKey];
      if (draftProductId) {
        map.set(draftProductId, row.raw_vendor_sku);
      }
    }
    return map;
  }, [rows, draftProductByLineKey]);

  /** Products available for a given row's combobox — excludes SKUs already claimed by other rows. */
  function getAvailableProductsForRow(row: ReceiptLineRow): ReceiptProductSummary[] {
    return products.filter((product) => {
      const claimedByVendorSku = usedProductIdToVendorSku.get(product.id);
      return !claimedByVendorSku || claimedByVendorSku === row.raw_vendor_sku;
    });
  }

  /** "⚡ Quick Create" — opens `QuickCreateDialog` for this row (adds a color/size variant onto an existing model). */
  function handleOpenQuickCreate(row: ReceiptLineRow) {
    setQuickCreateTarget(row);
  }

  /**
   * "➕ Full Matrix" — creates an entirely new product model with a full
   * color/size matrix. Opens `FullMatrixDialog`, which links out to the
   * `/products` Product Matrix Generator (not yet extracted into an
   * embeddable component) with the current vendor pre-filled.
   */
  function handleOpenFullMatrixModal(row: ReceiptLineRow) {
    setFullMatrixTarget(row);
  }

  /**
   * Quick Create succeeded — auto-select the new product for the row that
   * triggered it, then refresh the product cache so it's immediately
   * selectable/visible everywhere else in the table too.
   */
  function handleQuickProductCreated(product: ReceiptProductSummary) {
    if (quickCreateTarget) {
      handleDraftProductChange(quickCreateTarget.lineKey, product.id);
    }
    void refreshInternalProducts();
  }

  function beginRawEdit(row: ReceiptLineRow) {
    setEditingRawKey(row.lineKey);
    setRawDraft(row.raw_vendor_sku);
  }

  async function saveRawAndRematch(row: ReceiptLineRow) {
    if (rematchingKey || !vendorId) return;
    const nextRaw = rawDraft.trim();
    if (!nextRaw) {
      toast.error("ข้อความสินค้าจากบิลว่างเปล่า");
      return;
    }

    setRematchingKey(row.lineKey);
    const result = await rematchSingleOcrLineAction(vendorId, nextRaw);
    setRematchingKey(null);

    if (result.error) {
      toast.error(result.error);
      return;
    }

    setEditingRawKey(null);
    setRows((current) =>
      current.map((item) => {
        if (item.lineKey !== row.lineKey) return item;
        if (!result.matched || !result.internal_product_id || !result.mappingId) {
          return {
            ...item,
            raw_vendor_sku: nextRaw,
            status: "unmatched" as const,
            mappingId: null,
            matchedProduct: null,
            matchTier: null,
            similarityScore: null,
          };
        }
        return {
          ...item,
          raw_vendor_sku: nextRaw,
          status: "matched" as const,
          mappingId: result.mappingId,
          matchedProduct: {
            id: result.internal_product_id,
            sku: result.sku ?? "",
            name: result.product_name ?? result.sku ?? "สินค้า",
            color: result.color,
            size: result.size,
            tax_type: result.default_tax_type,
          },
          matchTier: result.match_tier,
          similarityScore: result.similarity_score,
          purchaseUomCode: result.purchase_uom_code || item.purchaseUomCode,
          conversionFactor:
            result.conversion_factor && result.conversion_factor > 0
              ? result.conversion_factor
              : item.conversionFactor,
        };
      }),
    );

    if (result.matched && result.internal_product_id && result.mappingId) {
      toast.success("จับคู่สินค้าใหม่อัตโนมัติสำเร็จ");
      return;
    }
    toast.message("ยังไม่พบคู่ที่ตรงกัน — ข้อความที่แก้แล้วพร้อมให้กด Confirm");
  }

  function beginSkuOverride(row: ReceiptLineRow) {
    setOverrideLineKey(row.lineKey);
    setDraftProductByLineKey((current) => ({
      ...current,
      [row.lineKey]: row.matchedProduct?.id ?? "",
    }));
  }

  function cancelSkuOverride(lineKey: string) {
    setOverrideLineKey((current) => (current === lineKey ? null : current));
    handleClearDraft(lineKey);
  }

  /** "Confirm Mapping" — saves the latest trimmed `raw_vendor_sku`, then refreshes the row. */
  async function handleConfirmMapping(row: ReceiptLineRow) {
    if (confirmingLineKey || !vendorId) return;

    const productId = draftProductByLineKey[row.lineKey];
    if (!productId) {
      toast.error("เลือกสินค้าภายในก่อนกด Confirm Mapping");
      return;
    }

    const product = products.find((item) => item.id === productId);
    if (!product) {
      toast.error("ไม่พบสินค้าที่เลือก");
      return;
    }

    const typedSku = (
      editingRawKey === row.lineKey ? rawDraft : row.raw_vendor_sku
    ).trim();
    const vendorSku = typedSku || product.name.trim() || product.sku;

    setConfirmingLineKey(row.lineKey);

    const result = await createOnTheFlyReceiptMapping({
      vendorId,
      vendorSku,
      vendorProductName: row.raw_description ?? product.name,
      internalProductId: productId,
      purchaseUomCode: row.purchaseUomCode,
      conversionFactor: row.conversionFactor,
    });

    setConfirmingLineKey(null);

    if (result.error || !result.product) {
      toast.error(result.error ?? "บันทึก mapping ไม่สำเร็จ");
      return;
    }

    const confirmedKey = normalizeOcrSkuText(typedSku || row.raw_vendor_sku);
    const siblingKeys = new Set<string>();
    const nextRows = rows.map((item) => {
      const sameConfirmedLine = item.lineKey === row.lineKey;
      const sameNormalizedSku =
        item.lineKey !== row.lineKey &&
        item.status === "unmatched" &&
        confirmedKey.length > 0 &&
        normalizeOcrSkuText(item.raw_vendor_sku) === confirmedKey;
      if (!sameConfirmedLine && !sameNormalizedSku) return item;
      if (sameNormalizedSku) siblingKeys.add(item.lineKey);
      return {
        ...item,
        raw_vendor_sku: sameConfirmedLine ? typedSku || item.raw_vendor_sku : item.raw_vendor_sku,
        status: "matched" as const,
        mappingId: result.mappingId,
        matchedProduct: result.product,
        matchTier: "EXACT" as const,
        similarityScore: 1,
      };
    });
    setRows(nextRows);
    setDraftProductByLineKey((current) => {
      const next = { ...current };
      delete next[row.lineKey];
      for (const lineKey of siblingKeys) delete next[lineKey];
      return next;
    });
    setOverrideLineKey((current) => (current === row.lineKey ? null : current));
    if (editingRawKey === row.lineKey) setEditingRawKey(null);
    toast.success(
      siblingKeys.size > 0
        ? `บันทึก Ground Truth แล้ว: ${row.raw_vendor_sku} ↔ ${result.product.sku} · จับคู่เพิ่ม ${siblingKeys.size.toLocaleString("th-TH")} แถวที่ข้อความตรงกัน`
        : `บันทึก Ground Truth แล้ว: ${row.raw_vendor_sku} ↔ ${result.product.sku}`,
    );
  }

  /** Toggle FOC (ของแถม) — FOC forces Total Amount / Net Cost = 0. */
  function handleToggleFoc(lineKey: string, isFoc: boolean) {
    setRows((current) => {
      const next = current.map((row) => {
        if (row.lineKey !== lineKey) return row;
        if (isFoc) {
          return {
            ...row,
            isFoc: true,
            totalAmount: 0,
            netCost: 0,
            totalAmountManual: false,
          };
        }
        return { ...row, isFoc: false, totalAmountManual: false };
      });
      return applyApportionedTotals(next, billDiscountText, calcMode, pennyDelta);
    });
    setVatTotalsManual(false);
  }

  function patchReviewLine(lineKey: string, patch: Partial<ReceiptLineRow>) {
    setRows((current) =>
      applyApportionedTotals(
        current.map((row) =>
          row.lineKey === lineKey
            ? { ...row, ...patch, totalAmountManual: false }
            : row,
        ),
        billDiscountText,
        calcMode,
        pennyDelta,
      ),
    );
    setVatTotalsManual(false);
    setVatAmountTouched(false);
    setGrandTouched(false);
  }

  function handleQtyChange(lineKey: string, raw: string) {
    const qty = Number(raw);
    if (!Number.isFinite(qty) || qty < 0) return;
    patchReviewLine(lineKey, { qty });
  }

  function handleUnitPriceChange(lineKey: string, raw: string) {
    if (raw.trim() === "") return;
    const unitPrice = Number(raw);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) return;
    patchReviewLine(lineKey, { unit_price: roundTo4Decimals(unitPrice) });
  }

  function duplicateReviewRow(row: ReceiptLineRow) {
    const lineKey = `copy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const copy: ReceiptLineRow = {
      lineKey,
      raw_vendor_sku: row.raw_vendor_sku,
      raw_description: row.raw_description,
      qty: row.qty,
      unit_price: row.unit_price,
      discount_text: row.discount_text,
      status: "unmatched",
      mappingId: null,
      matchedProduct: null,
      matchTier: null,
      similarityScore: null,
      discountAmountPerUnit: 0,
      netCost: 0,
      totalAmount: 0,
      purchaseUomCode: row.purchaseUomCode || "PCS",
      conversionFactor: row.conversionFactor || 1,
      totalAmountManual: false,
      isFoc: row.isFoc,
    };
    setRows((current) => {
      const index = current.findIndex((item) => item.lineKey === row.lineKey);
      const next = [...current];
      next.splice(Math.max(index, 0) + 1, 0, copy);
      return applyApportionedTotals(next, billDiscountText, calcMode, pennyDelta);
    });
    setEditingRawKey(lineKey);
    setRawDraft(row.raw_vendor_sku);
    setDraftProductByLineKey((current) => ({ ...current, [lineKey]: "" }));
    setVatTotalsManual(false);
  }

  function deleteReviewRow(lineKey: string) {
    setRows((current) =>
      applyApportionedTotals(
        current.filter((row) => row.lineKey !== lineKey),
        billDiscountText,
        calcMode,
        pennyDelta,
      ),
    );
    if (editingRawKey === lineKey) setEditingRawKey(null);
    if (overrideLineKey === lineKey) setOverrideLineKey(null);
    setDraftProductByLineKey((current) => {
      const next = { ...current };
      delete next[lineKey];
      return next;
    });
    setVatTotalsManual(false);
    setVatAmountTouched(false);
    setGrandTouched(false);
  }

  function addMissingReviewRow() {
    const lineKey = `manual-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const blank: ReceiptLineRow = {
      lineKey,
      raw_vendor_sku: "",
      raw_description: null,
      qty: 1,
      unit_price: 0,
      discount_text: "",
      status: "unmatched",
      mappingId: null,
      matchedProduct: null,
      matchTier: null,
      similarityScore: null,
      discountAmountPerUnit: 0,
      netCost: 0,
      totalAmount: 0,
      purchaseUomCode: "PCS",
      conversionFactor: 1,
      totalAmountManual: false,
      isFoc: false,
    };
    setRows((current) =>
      applyApportionedTotals([...current, blank], billDiscountText, calcMode, pennyDelta),
    );
    setEditingRawKey(lineKey);
    setRawDraft("");
    setDraftProductByLineKey((current) => ({ ...current, [lineKey]: "" }));
    setVatTotalsManual(false);
  }

  /** Manual Total Amount (paper Ground Truth) → Net Unit Cost = Total / Qty. */
  function handleTotalAmountChange(lineKey: string, raw: string) {
    const total = roundMoney2(Math.max(0, parseMoneyInput(raw)));
    setRows((current) =>
      current.map((row) => {
        if (row.lineKey !== lineKey) return row;
        if (row.isFoc) {
          return { ...row, totalAmount: 0, netCost: 0, totalAmountManual: true };
        }
        const qty = Math.max(0, Number(row.qty) || 0);
        return {
          ...row,
          totalAmount: total,
          netCost: qty > 0 ? roundMoney2(total / qty) : 0,
          totalAmountManual: true,
        };
      }),
    );
    setVatTotalsManual(false);
  }

  function handlePurchaseUomChange(
    lineKey: string,
    uomCode: string,
    conversionFactor: number,
  ) {
    setRows((current) =>
      applyApportionedTotals(
        current.map((row) =>
          row.lineKey === lineKey
            ? { ...row, purchaseUomCode: uomCode, conversionFactor }
            : row,
        ),
        billDiscountText,
        calcMode,
        pennyDelta,
      ),
    );
  }

  function handleBillDiscountChange(value: string) {
    setBillDiscountText(value);
    setPennyDelta(0);
    setRoundingGap(0);
    setRows((current) => applyApportionedTotals(current, value, calcMode, 0));
    setVatTotalsManual(false);
  }

  const stats = {
    total: rows.length,
    matched: rows.filter((row) => row.status === "matched").length,
    unmatched: rows.filter((row) => row.status === "unmatched").length,
  };

  const totals = {
    qty: rows.reduce(
      (sum, row) =>
        sum + stockBaseQty(Number(row.qty) || 0, row.conversionFactor),
      0,
    ),
    value: rows.reduce(
      (sum, row) => sum + (row.isFoc ? 0 : Number(row.totalAmount) || 0),
      0,
    ),
  };

  const freightCostNormalized = useMemo(
    () => roundMoney2(Math.max(0, parseMoneyInput(freightCostInput))),
    [freightCostInput],
  );

  const landedByLineKey = useMemo(() => {
    return new Map(
      calculateLandedCost(
        freightCostNormalized,
        rows.map((row) => {
          const qty = Math.max(0, Number(row.qty) || 0);
          const total = row.isFoc ? 0 : Math.max(0, Number(row.totalAmount) || 0);
          return {
            id: row.lineKey,
            qty,
            lineNetAmount: total,
            unitNetCost: qty > 0 ? total / qty : 0,
            isFoc: row.isFoc,
          };
        }),
        {
          vatType: aiVatType,
          vatRate: aiVatType === "NONE" ? 0 : 7,
          freightTaxMode,
          destFreightCost: roundMoney2(Math.max(0, parseMoneyInput(destFreightInput))),
        },
      ).map((row) => [row.id, row]),
    );
  }, [rows, freightCostNormalized, destFreightInput, freightTaxMode, aiVatType]);

  /**
   * Auto VAT from line Total Amounts (already include line/bill discounts).
   * sub_total = Σ line_net + freight_cost → แล้วคำนวณ VAT / Grand Total
   */
  const vatPreview = useMemo(() => {
    const lineTotals = rows.map((row) =>
      row.isFoc ? 0 : Math.max(0, Number(row.totalAmount) || 0),
    );
    return calculateDocumentSummary({
      lineTotals,
      freightCost: freightCostNormalized,
      discountText: null,
      vatType: aiVatType,
      vatRate: aiVatType === "NONE" ? 0 : 7,
    });
  }, [rows, aiVatType, freightCostNormalized]);

  const calcQuotes = useMemo(
    () =>
      quoteVendorCalcModes(
        rows.map((row) => ({
          id: row.lineKey,
          unitPrice: Number(row.unit_price) || 0,
          qty: Math.max(0, Number(row.qty) || 0),
          discountText: row.discount_text,
          isFoc: Boolean(row.isFoc),
        })),
        billDiscountText,
        aiVatType === "INCLUSIVE" || aiVatType === "EXCLUSIVE" ? aiVatType : "NONE",
      ),
    [rows, billDiscountText, aiVatType],
  );
  const showCalcModes = vendorCalcSpread(calcQuotes) >= 0.01;

  const goodsNet = useMemo(
    () =>
      roundMoney2(
        rows.reduce(
          (sum, row) => sum + (row.isFoc ? 0 : Math.max(0, Number(row.totalAmount) || 0)),
          0,
        ),
      ),
    [rows],
  );

  const destFreightNormalized = useMemo(
    () => roundMoney2(Math.max(0, parseMoneyInput(destFreightInput))),
    [destFreightInput],
  );

  const goodsExVatTotal = useMemo(
    () =>
      roundMoney2(
        rows.reduce((sum, row) => {
          if (row.isFoc) return sum;
          return (
            sum +
            exVatGoodsAmount(Math.max(0, Number(row.totalAmount) || 0), aiVatType)
          );
        }, 0),
      ),
    [rows, aiVatType],
  );

  const originFreightInventory = useMemo(() => {
    if (freightTaxMode === "SEPARATE_NON_VAT") return freightCostNormalized;
    return roundMoney2(
      resolveFreightExVat(
        freightCostNormalized,
        aiVatType,
        aiVatType === "NONE" ? 0 : 7,
      ),
    );
  }, [freightCostNormalized, freightTaxMode, aiVatType]);

  const landedCostPool = roundMoney2(
    goodsExVatTotal + originFreightInventory + destFreightNormalized,
  );
  const landedUnitAverage = totals.qty > 0 ? landedCostPool / totals.qty : 0;
  const destCarrierName =
    carriers.find((carrier) => carrier.carrier_id === carrierId)?.carrier_name ??
    "ยังไม่เลือกบริษัทขนส่ง";
  const originFreightApLabel =
    freightTaxMode === "SEPARATE_NON_VAT"
      ? "ค่าขนส่งต้นทาง (ชำระแยก Non-VAT)"
      : "ค่าขนส่งต้นทาง (รวมในใบกำกับภาษี)";
  const vatRowLabel =
    aiVatType === "EXCLUSIVE"
      ? "ภาษีมูลค่าเพิ่ม 7% (Excluded)"
      : aiVatType === "INCLUSIVE"
        ? "ภาษีมูลค่าเพิ่ม 7% (Included)"
        : "ภาษีมูลค่าเพิ่ม 0%";

  const receiptVat = useMemo(() => {
    return computeVendorPayable({
      goodsNet,
      originFreight: freightCostNormalized,
      freightTaxMode,
      vatType: aiVatType,
      manualVatAmount: vatAmountTouched
        ? roundMoney2(Math.max(0, parseMoneyInput(vatAmountInput)))
        : null,
    });
  }, [
    goodsNet,
    freightCostNormalized,
    freightTaxMode,
    aiVatType,
    vatAmountTouched,
    vatAmountInput,
  ]);

  const vendorGrandTotal = grandTouched
    ? roundMoney2(parseMoneyInput(grandTotalInput))
    : receiptVat.grandTotal;
  const displayedVatAmount = vatAmountTouched
    ? roundMoney2(Math.max(0, parseMoneyInput(vatAmountInput)))
    : receiptVat.vatAmount;

  useEffect(() => {
    if (!netBeforeTouched) {
      setNetBeforeVatInput(roundMoney2(receiptVat.preVatAmount).toFixed(2));
    }
    if (!vatAmountTouched) {
      setVatAmountInput(roundMoney2(receiptVat.vatAmount).toFixed(2));
    }
    if (!grandTouched) {
      setGrandTotalInput(roundMoney2(receiptVat.grandTotal).toFixed(2));
    }
  }, [receiptVat, vatAmountTouched, grandTouched, netBeforeTouched]);

  function handleCalcModeChange(mode: VendorCalcMode) {
    setCalcMode(mode);
    setPennyDelta(0);
    setRoundingGap(0);
    setNetBeforeTouched(false);
    setVatAmountTouched(false);
    setGrandTouched(false);
    setVatTotalsManual(false);
    setRows((current) => applyApportionedTotals(current, billDiscountText, mode, 0));
    if (!vendorId) return;
    void saveVendorRoundingCalcMode(vendorId, mode).then((result) => {
      if (result.error) toast.error(result.error);
    });
  }

  function balanceLastLine(delta: number, gap: number) {
    const pennies = roundMoney2(delta);
    if (!pennies) return;
    if (Math.abs(pennies) > 0.1) {
      toast.warning("ปรับเศษได้ครั้งละไม่เกิน ±0.10 บาท");
      return;
    }
    setPennyDelta(pennies);
    setRoundingGap(roundMoney2(gap));
    setNetBeforeTouched(false);
    setVatAmountTouched(false);
    setGrandTouched(false);
    setRows((current) => applyApportionedTotals(current, billDiscountText, calcMode, pennies));
  }

  function handlePreVatBlur() {
    const typed = roundMoney2(parseMoneyInput(netBeforeVatInput));
    const freightInBase = freightTaxMode === "SEPARATE_NON_VAT" ? 0 : freightCostNormalized;
    const targetGoods =
      aiVatType === "INCLUSIVE"
        ? roundMoney2(roundMoney2(typed * 1.07) - freightInBase)
        : roundMoney2(typed - freightInBase);
    const delta = roundMoney2(targetGoods - goodsNet);
    const nextGrand =
      aiVatType === "EXCLUSIVE"
        ? roundMoney2(typed + roundMoney2(typed * 0.07))
        : aiVatType === "INCLUSIVE"
          ? roundMoney2(typed * 1.07)
          : typed;
    balanceLastLine(delta, roundMoney2(nextGrand - receiptVat.grandTotal));
  }

  function handleGrandBlur() {
    const typed = roundMoney2(parseMoneyInput(grandTotalInput));
    const gap = roundMoney2(typed - receiptVat.grandTotal);
    if (!gap) return;
    if (Math.abs(gap) > 0.1) {
      toast.warning("ปรับเศษได้ครั้งละไม่เกิน ±0.10 บาท");
      return;
    }
    const freightInBase = freightTaxMode === "SEPARATE_NON_VAT" ? 0 : freightCostNormalized;
    let delta = gap;
    if (aiVatType === "EXCLUSIVE") {
      delta = roundMoney2(gap / 1.07);
    } else if (aiVatType === "INCLUSIVE") {
      delta = gap;
    }
    const targetGoods = roundMoney2(goodsNet + delta);
    const payable = roundMoney2(
      aiVatType === "EXCLUSIVE"
        ? roundMoney2((targetGoods + freightInBase) * 1.07)
        : targetGoods + freightInBase,
    );
    if (Math.abs(payable - typed) > 0.02) {
      setRoundingGap(gap);
      setGrandTouched(true);
      return;
    }
    balanceLastLine(delta, gap);
  }

  function moveUnmatchedRowToOriginFreight(row: ReceiptLineRow) {
    const amount = row.isFoc
      ? 0
      : originFreightLineAmount(row.qty, row.unit_price) ||
        roundMoney2(Math.max(0, Number(row.totalAmount) || 0));
    setFreightCostInput((current) => {
      const next = roundMoney2(parseMoneyInput(current) + amount);
      return next > 0 ? next.toFixed(2) : "";
    });
    setRows((current) => current.filter((item) => item.lineKey !== row.lineKey));
    setVatAmountTouched(false);
    setGrandTouched(false);
    toast.success(`ย้าย ${formatMoney(amount)} บาท ไปค่าขนส่งต้นทางแล้ว`);
  }

  function applyProductTaxConsensus() {
    if (!taxConsensus.consensusTaxType) return;
    setAiVatType(purchaseTaxModeToVatType(taxConsensus.consensusTaxType));
    setTaxModeSource("product");
    setVatAmountTouched(false);
    setGrandTouched(false);
    setVatTotalsManual(false);
  }

  function handleTaxModeChange(mode: PurchaseTaxMode) {
    setAiVatType(purchaseTaxModeToVatType(mode));
    setTaxModeSource("manual");
    setVatAmountTouched(false);
    setGrandTouched(false);
    setVatTotalsManual(false);
  }

  function handleVatAmountChange(raw: string) {
    const vat = roundMoney2(Math.max(0, parseMoneyInput(raw)));
    setVatAmountInput(raw);
    setVatAmountTouched(true);
    setGrandTouched(false);
    setVatTotalsManual(true);
    if (aiVatType === "NONE" && vat > 0) {
      setAiVatType("EXCLUSIVE");
      setTaxModeSource("vat-input");
    }
  }

  /**
   * roundingDifference = Manual Grand Total − Calculated Grand Total
   * (Calculated มาจากผลรวม Total Amount รายบรรทัด + โหมด VAT)
   */
  const roundingDifference = useMemo(() => {
    const manualGrand = roundMoney2(parseMoneyInput(grandTotalInput));
    const calculatedGrand = roundMoney2(receiptVat.grandTotal);
    return roundMoney2(manualGrand - calculatedGrand);
  }, [grandTotalInput, receiptVat.grandTotal]);

  const taxConsensus = useMemo(
    () =>
      analyzeLineItemsTaxConsensus(
        rows.map((row, index) => ({
          lineNo: index + 1,
          taxType: row.status === "matched" ? row.matchedProduct?.tax_type : null,
          matched: row.status === "matched",
        })),
      ),
    [rows],
  );
  const minorityModes = useMemo(
    () => new Set(minorityTaxModes(taxConsensus.groups)),
    [taxConsensus.groups],
  );
  const conflictKey = taxConsensus.groups
    .map((group) => `${group.mode}:${group.lineNos.join(",")}`)
    .join("|");

  useEffect(() => {
    setMixedTaxConfirmed(false);
  }, [conflictKey]);

  useEffect(() => {
    if (taxModeSource === "manual" || taxModeSource === "vat-input") return;
    if (!taxConsensus.hasUnanimousConsensus || !taxConsensus.consensusTaxType) return;
    const nextVat = purchaseTaxModeToVatType(taxConsensus.consensusTaxType);
    if (nextVat === aiVatType) {
      if (taxModeSource !== "product") setTaxModeSource("product");
      return;
    }
    setAiVatType(nextVat);
    setTaxModeSource("product");
    setVatAmountTouched(false);
    setGrandTouched(false);
    setVatTotalsManual(false);
  }, [aiVatType, taxConsensus, taxModeSource]);

  const canSaveToLedger =
    rows.length > 0 &&
    stats.unmatched === 0 &&
    !isSavingToLedger &&
    !isOcrRunning &&
    (!taxConsensus.hasMixedTaxConflict || mixedTaxConfirmed);

  /** "Save to Ledger" button — opens the confirmation dialog (Invoice No + Date review + Early Warning check). */
  function handleOpenSaveDialog() {
    if (!canSaveToLedger) return;
    setIsSaveDialogOpen(true);
  }

  /**
   * Finalizes the receipt with the user-confirmed doc number/date/bill
   * discount from `SaveToLedgerDialog`, then calls `saveGoodsReceiptToLedger`
   * — the ONLY path that writes stock movements (via `inventory_ledger`),
   * never directly to `products`. Each row's `isFoc` travels with `rows`.
   */
  async function handleConfirmSaveToLedger(payload: SaveToLedgerConfirmPayload) {
    setIsSavingToLedger(true);
    // Sync bill discount from dialog → re-seed non-manual line totals only
    const rowsForSave = applyApportionedTotals(
      rows,
      payload.billDiscountText,
      calcMode,
      pennyDelta,
    );
    setBillDiscountText(payload.billDiscountText);
    setRows(rowsForSave);
    try {
      if (destFreightNormalized > 0 && !carrierId) {
        toast.error("ค่าขนส่งปลายทางต้องเลือกบริษัทขนส่ง");
        return;
      }
      const saveGoodsNet = roundMoney2(
        rowsForSave.reduce(
          (sum, row) =>
            sum + (row.isFoc ? 0 : Math.max(0, Number(row.totalAmount) || 0)),
          0,
        ),
      );
      const saveVat = computeVendorPayable({
        goodsNet: saveGoodsNet,
        originFreight: freightCostNormalized,
        freightTaxMode,
        vatType: payload.vatType,
        manualVatAmount:
          vatAmountTouched && payload.vatType === "EXCLUSIVE"
            ? roundMoney2(Math.max(0, parseMoneyInput(vatAmountInput)))
            : null,
      });
      const typedGrand = roundMoney2(parseMoneyInput(grandTotalInput));
      const grandTotal = grandTouched ? typedGrand : saveVat.grandTotal;

      const result = await saveGoodsReceiptToLedger(
        rowsForSave,
        payload.docNumber,
        payload.docDate,
        payload.billDiscountText || null,
        payload.docType,
        payload.vatType,
        null,
        {
          netBeforeVat: saveVat.preVatAmount,
          vatAmount: saveVat.vatAmount,
          grandTotal,
          roundingDifference: roundingGap || roundMoney2(grandTotal - saveVat.grandTotal),
        },
        freightCostNormalized,
        {
          freightTaxMode,
          destFreightCost: destFreightNormalized,
          carrierId,
          carrierTrackingNo,
        },
        null,
        payload.taxInvoiceStatus,
      );
      if (!result.docHeaderId || !result.docNo) {
        toast.error(result.error ?? "บันทึกรับสินค้าเข้าคลังไม่สำเร็จ");
        return;
      }

      let billWarning: string | null = result.error;
      if (pendingFiles.length > 0) {
        const uploaded = await uploadProcurementBills(pendingFiles, result.docNo);
        if (uploaded.error || !uploaded.data) {
          billWarning =
            uploaded.error ?? "อัปโหลดภาพบิลขึ้น procurement_bills ไม่สำเร็จ";
        } else {
          const saved = await saveDocumentProcurementBills({
            documentId: result.docHeaderId,
            docHeaderId: result.docHeaderId,
            bills: uploaded.data,
          });
          if (!saved.success) {
            billWarning = saved.error ?? "บันทึก URL รูปบิลลงหัวเอกสารไม่สำเร็จ";
          }
        }
      }

      toast.success(
        `บันทึกรับสินค้าเข้าคลังสำเร็จ — เอกสาร ${result.docNo} (${stats.matched.toLocaleString("th-TH")} รายการ)`,
      );
      if (vendorId) {
        const remembered = await saveVendorRoundingCalcMode(vendorId, calcMode);
        if (remembered.error) toast.error(remembered.error);
      }
      if (billWarning) {
        toast.error(`เอกสารถูกบันทึกแล้ว แต่ผูกไฟล์บิลไม่สำเร็จ: ${billWarning}`);
      }
      setIsSaveDialogOpen(false);
      clearInvoice();
      router.push(
        `/purchases/${encodeURIComponent(result.docNo)}?view=form&paper=A5-Portrait`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "บันทึกรับสินค้าเข้าคลังไม่สำเร็จ");
    } finally {
      setIsSavingToLedger(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      {/* Header */}
      <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-blue-600">
            PROCUREMENT · OCR INTEGRATION
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
            Smart Goods Receipt
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            เลือกผู้จำหน่าย → ลากวางรูปบิล → กด Parse with AI → ตรวจทานและยืนยันรายการที่ยังไม่จับคู่
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {ocrQuota ? (
            <div className="max-w-md rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left">
              <p className="text-[11px] font-semibold leading-snug text-slate-700">
                {ocrQuota.models.length > 0
                  ? ocrQuota.models.map((model) => formatOcrQuotaChip(model)).join(" | ")
                  : "ยังไม่มีข้อมูลโควตา OCR"}
              </p>
              <a
                href="https://ai.dev/rate-limit"
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex items-center gap-1 text-[10px] text-slate-500 hover:text-blue-700"
              >
                {ocrQuota.resetNote}
                <ExternalLink className="size-3" aria-hidden />
              </a>
              {ocrQuota.error ? (
                <p className="mt-1 text-[10px] text-red-600">{ocrQuota.error}</p>
              ) : null}
            </div>
          ) : null}
          <Button
            type="button"
            variant="outline"
            onClick={() => setFreightSummaryOpen(true)}
          >
            สรุปค่าขนส่งปลายทาง (ขอใบเสร็จ)
          </Button>
          <div className="rounded-xl bg-slate-100 px-3 py-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              OCR Lines
            </p>
            <p className="text-lg font-bold text-slate-800">
              {stats.total.toLocaleString("th-TH")}
            </p>
          </div>
          <div className="rounded-xl bg-emerald-50 px-3 py-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-600">
              Matched
            </p>
            <p className="text-lg font-bold text-emerald-700">
              {stats.matched.toLocaleString("th-TH")}
            </p>
          </div>
          <div className="rounded-xl bg-amber-50 px-3 py-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
              Unmatched
            </p>
            <p className="text-lg font-bold text-amber-700">
              {stats.unmatched.toLocaleString("th-TH")}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* 1. Vendor selection */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700">
                1
              </span>
              ผู้จำหน่าย (Smart Combobox)
            </CardTitle>
            <CardDescription>
              เลือก Vendor เพื่อค้นหา mapping ที่ผูกไว้แล้ว
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>
                Vendor <span className="text-red-500">*</span>
              </Label>
              <VendorCombobox
                options={vendors}
                value={vendorId}
                onChange={handleVendorChange}
                disabled={isOcrRunning}
                isLoading={false}
              />
              {vendorsError && (
                <p className="mt-1 text-xs text-red-600">{vendorsError}</p>
              )}
            </div>
            {!vendorId && (
              <p className="text-[11px] font-medium text-amber-600">
                ต้องเลือก Vendor ก่อนจึงจะวิเคราะห์บิลได้
              </p>
            )}
          </CardContent>
        </Card>

        {/* 2. Upload zone */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="grid size-6 place-items-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700">
                2
              </span>
              อัปโหลดรูปบิล (Drag &amp; Drop)
            </CardTitle>
            <CardDescription>
              เก็บไฟล์ไว้ในเครื่อง แล้วกด Parse with AI เพื่อเรียก{" "}
              <code className="text-xs">parseReceiptOcr</code> (Gemini Vision จริง)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <InvoiceDropzone
              disabled={isOcrRunning}
              isProcessing={isOcrRunning}
              fileName={fileName}
              previewUrl={previewUrl}
              onFilesSelected={(files) => void handleFilesSelected(files)}
              onClear={clearInvoice}
            />
            {pendingFiles.length > 0 && (
              <Button
                type="button"
                onClick={() => void handleRunOcr()}
                disabled={!vendorId || pendingFiles.length === 0 || isOcrRunning}
                className="w-full"
              >
                <Sparkles className="size-4" aria-hidden />
                {isOcrRunning
                  ? "กำลังวิเคราะห์บิลด้วย AI…"
                  : rows.length > 0
                    ? "วิเคราะห์อีกครั้ง (Re-parse with AI)"
                    : "Parse with AI"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      {/* 3. Review table */}
      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-slate-900">
              <span className="grid size-6 place-items-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700">
                3
              </span>
              ตารางตรวจทานรายการ (OCR Ground Truth)
            </h2>
            <p className="mt-0.5 pl-8 text-xs text-slate-500">
              <code className="text-xs">raw_vendor_sku</code> คือค่าจริงเสมอ — เลือกสินค้าภายในแล้วกด Confirm Mapping เพื่อบันทึก
            </p>
          </div>

          {rows.length > 0 && (
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor="ocr-doc-number"
                  className="text-[11px] font-semibold text-slate-500"
                >
                  เลขที่เอกสาร (สกัดจาก OCR — แก้ไขได้)
                </Label>
                <Input
                  id="ocr-doc-number"
                  value={ocrDocNumber}
                  onChange={(event) => setOcrDocNumber(event.target.value)}
                  placeholder="ไม่พบเลขที่เอกสารบนบิล — กรอกเองได้"
                  className="h-9 w-56 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label
                  htmlFor="ocr-doc-date"
                  className="text-[11px] font-semibold text-slate-500"
                >
                  วันที่เอกสาร (สกัดจาก OCR — แก้ไขได้)
                </Label>
                <Input
                  id="ocr-doc-date"
                  type="date"
                  value={ocrDocDate}
                  onChange={(event) => setOcrDocDate(event.target.value)}
                  className="h-9 w-40 text-sm"
                />
              </div>
            </div>
          )}
        </div>

        {rows.length === 0 && !isOcrRunning ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                <UploadCloud className="size-5" aria-hidden />
              </div>
              <p className="text-sm font-semibold text-slate-700">
                ยังไม่มีรายการ OCR
              </p>
              <p className="max-w-sm text-xs text-slate-400">
                เลือก Vendor แล้วลากวางรูปบิล จากนั้นกด Parse with AI — ระบบจะแสดงรายการที่สกัดได้ในตารางนี้
              </p>
              <Button type="button" variant="outline" onClick={addMissingReviewRow}>
                + เพิ่มรายการที่ตกหล่น (Add Missing Item)
              </Button>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden border-slate-200">
            <CardContent className="relative px-0 pb-2">
              {isOcrRunning ? (
                <div
                  role="status"
                  aria-live="polite"
                  className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/85 backdrop-blur-[2px]"
                >
                  <div className="size-8 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                  <p className="text-sm font-semibold text-slate-700">
                    กำลังวิเคราะห์บิล…
                  </p>
                </div>
              ) : null}

              <Table
                wrapperClassName="overflow-x-hidden"
                className="w-full table-fixed border-collapse"
              >
                <colgroup>
                  <col className="w-[4%]" />
                  <col className="w-[43%]" />
                  <col className="w-[4%]" />
                  <col className="w-[13%]" />
                  <col className="w-[9%]" />
                  <col className="w-[6%]" />
                  <col className="w-[8%]" />
                  <col className="w-[8%]" />
                  <col className="w-[5%]" />
                </colgroup>
                <TableHeader>
                  <TableRow className="bg-slate-50 hover:bg-slate-50">
                    <TableHead className="h-auto w-[4%] px-1.5 py-2 text-center normal-case tracking-normal">
                      #
                    </TableHead>
                    <TableHead className="h-auto w-[43%] px-1.5 py-2 text-left normal-case tracking-normal">
                      รายการสินค้าภายใน & ข้อมูลบิล OCR
                    </TableHead>
                    <TableHead className="h-auto w-[4%] px-1.5 py-2 text-center normal-case tracking-normal">
                      ของแถม
                    </TableHead>
                    <TableHead className="h-auto w-[13%] px-1.5 py-2 text-center normal-case tracking-normal">
                      จำนวน / หน่วย
                    </TableHead>
                    <TableHead className="h-auto w-[9%] px-1.5 py-2 text-right normal-case tracking-normal">
                      ราคา/หน่วย
                    </TableHead>
                    <TableHead className="h-auto w-[6%] px-1.5 py-2 text-center normal-case tracking-normal">
                      ส่วนลด
                    </TableHead>
                    <TableHead className="h-auto w-[8%] px-1.5 py-2 text-right normal-case tracking-normal">
                      ทุนสุทธิ
                    </TableHead>
                    <TableHead className="h-auto w-[8%] px-1.5 py-2 text-right normal-case tracking-normal">
                      รวมเงิน
                    </TableHead>
                    <TableHead className="h-auto w-[5%] px-1.5 py-2 text-center normal-case tracking-normal">
                      จัดการ
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, index) => {
                    const isMatched = row.status === "matched";
                    const isFuzzy = isMatched && row.matchTier === "FUZZY";
                    const isOverriding = overrideLineKey === row.lineKey;
                    const isEditingRaw = editingRawKey === row.lineKey;
                    const isBusy =
                      confirmingLineKey === row.lineKey || rematchingKey === row.lineKey;
                    const draftProductId = draftProductByLineKey[row.lineKey] ?? "";
                    const qty = Math.max(0, Number(row.qty) || 0);
                    const factor = resolveConversionFactor(row.conversionFactor);
                    const baseQty = stockBaseQty(qty, factor);
                    const displayTotalAmount = row.isFoc
                      ? 0
                      : roundMoney2(Number(row.totalAmount) || 0);
                    const freightShare =
                      landedByLineKey.get(row.lineKey)?.proratedFreight ?? 0;
                    const goodsExVat = exVatGoodsAmount(displayTotalAmount, aiVatType);
                    const displayNetUnitCost = row.isFoc
                      ? 0
                      : baseQty > 0
                        ? roundMoney2((goodsExVat + freightShare) / baseQty)
                        : 0;
                    const uom = purchaseUoms.find(
                      (item) => item.uom_code === (row.purchaseUomCode || "PCS"),
                    );
                    const showSkuPicker = !isMatched || !row.matchedProduct || isOverriding;

                    return (
                      <TableRow
                        key={row.lineKey}
                        className={cn(
                          "border-b transition-colors",
                          showSkuPicker
                            ? "border-b-amber-200 border-l-4 border-l-amber-500 bg-amber-50/80"
                            : index % 2 === 0
                              ? "border-slate-200/80 bg-white hover:bg-blue-50/40"
                              : "border-slate-200/80 bg-slate-50/90 hover:bg-blue-50/40",
                        )}
                      >
                        <TableCell className="px-1.5 py-2 text-center">
                          <span className="inline-flex rounded bg-slate-200/70 px-1.5 py-0.5 text-xs font-semibold text-slate-700">
                            {index + 1}
                          </span>
                        </TableCell>

                        <TableCell className="min-w-0 px-1.5 py-2 text-left">
                          {showSkuPicker ? (
                            <div className="space-y-1.5">
                              <div className="flex min-w-0 items-center gap-1.5">
                                <div className="min-w-0 flex-1">
                                  <InternalProductCombobox
                                    products={getAvailableProductsForRow(row)}
                                    value={draftProductId}
                                    disabled={isBusy}
                                    onChange={(productId) =>
                                      handleDraftProductChange(row.lineKey, productId)
                                    }
                                    onCreateFullMatrix={() => handleOpenFullMatrixModal(row)}
                                    onQuickCreate={() => handleOpenQuickCreate(row)}
                                    placeholder="ค้นหา SKU ภายใน..."
                                  />
                                </div>
                                {draftProductId ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-8 w-8 shrink-0 border-slate-300 text-slate-500"
                                    disabled={isBusy}
                                    onClick={() => handleClearDraft(row.lineKey)}
                                    aria-label="ล้างการเลือกสินค้า"
                                    title="ล้างการเลือกสินค้า"
                                  >
                                    <X className="size-3.5" aria-hidden />
                                  </Button>
                                ) : null}
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-8 shrink-0 bg-emerald-600 px-2 hover:bg-emerald-700"
                                  disabled={!draftProductId || isBusy}
                                  onClick={() => void handleConfirmMapping(row)}
                                >
                                  {isBusy ? "..." : "Confirm"}
                                </Button>
                                {isOverriding ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="h-8 shrink-0 px-2"
                                    disabled={isBusy}
                                    onClick={() => cancelSkuOverride(row.lineKey)}
                                  >
                                    ยกเลิก
                                  </Button>
                                ) : null}
                              </div>
                              {isOverriding ? null : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-6 px-2 text-[11px]"
                                  disabled={isBusy}
                                  onClick={() => moveUnmatchedRowToOriginFreight(row)}
                                >
                                  ย้ายไปค่าส่งต้นทาง
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-start gap-1.5">
                              <CheckCircle2
                                className={cn(
                                  "mt-0.5 size-3.5 shrink-0",
                                  isFuzzy ? "text-amber-600" : "text-emerald-600",
                                )}
                                aria-hidden
                              />
                              <p className="min-w-0 flex-1 whitespace-normal break-words text-sm font-semibold leading-snug text-slate-900">
                                {row.matchedProduct?.name}
                                <span className="ml-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-normal text-slate-600">
                                  {row.matchedProduct?.sku}
                                </span>
                                {row.matchedProduct?.tax_type ? (
                                  <span
                                    className={cn(
                                      "ml-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                      normalizePurchaseTaxMode(row.matchedProduct.tax_type) &&
                                        minorityModes.has(
                                          normalizePurchaseTaxMode(row.matchedProduct.tax_type)!,
                                        )
                                        ? "animate-pulse bg-red-100 text-red-800 ring-2 ring-red-500"
                                        : "bg-violet-100 text-violet-700",
                                    )}
                                  >
                                    {normalizePurchaseTaxMode(row.matchedProduct.tax_type) ??
                                      row.matchedProduct.tax_type}
                                  </span>
                                ) : null}
                              </p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-6 shrink-0 px-2 text-[11px]"
                                disabled={isBusy}
                                onClick={() => beginSkuOverride(row)}
                              >
                                <RefreshCw className="size-3" aria-hidden />
                                เปลี่ยน
                              </Button>
                            </div>
                          )}

                          {isEditingRaw ? (
                            <div className="mt-1 flex items-center gap-1.5">
                              <Input
                                value={rawDraft}
                                autoFocus
                                disabled={isBusy}
                                className="h-7 font-mono text-xs"
                                aria-label={`แก้ข้อความ OCR ${row.raw_vendor_sku}`}
                                onChange={(event) => setRawDraft(event.target.value)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void saveRawAndRematch(row);
                                  }
                                  if (event.key === "Escape") setEditingRawKey(null);
                                }}
                              />
                              <Button
                                type="button"
                                size="icon"
                                className="h-7 w-7 shrink-0 p-0"
                                disabled={isBusy}
                                title="บันทึกและจับคู่ใหม่"
                                onClick={() => void saveRawAndRematch(row)}
                              >
                                {rematchingKey === row.lineKey ? (
                                  <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                                ) : (
                                  <Check className="size-3.5" aria-hidden />
                                )}
                              </Button>
                            </div>
                          ) : (
                            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                              <span className="font-semibold text-slate-400">OCR:</span>
                              <span className={cn(row.isFoc && "line-through")}>
                                {row.raw_vendor_sku || "—"}
                              </span>
                              {row.raw_description ? (
                                <span className="whitespace-normal break-words">
                                  {row.raw_description}
                                </span>
                              ) : null}
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-6 w-6 shrink-0 p-0 text-slate-500"
                                disabled={isBusy}
                                title="แก้ข้อความ OCR"
                                aria-label={`แก้ข้อความ OCR ${row.raw_vendor_sku}`}
                                onClick={() => beginRawEdit(row)}
                              >
                                <Pencil className="h-3.5 w-3.5" aria-hidden />
                              </Button>
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="px-1 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={Boolean(row.isFoc)}
                            onChange={(event) =>
                              handleToggleFoc(row.lineKey, event.target.checked)
                            }
                            className="mx-auto block size-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                            aria-label={`ของแถม ${row.raw_vendor_sku}`}
                          />
                        </TableCell>

                        <TableCell className="px-1 py-2 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Input
                              type="number"
                              inputMode="decimal"
                              min="0.0001"
                              step="any"
                              value={Number.isFinite(qty) ? qty : 0}
                              disabled={isBusy}
                              onChange={(event) =>
                                handleQtyChange(row.lineKey, event.target.value)
                              }
                              className="h-8 w-16 px-2 text-right text-sm font-semibold"
                              aria-label={`จำนวน ${row.raw_vendor_sku || "รายการ"}`}
                            />
                            {purchaseUoms.length > 0 ? (
                              <Select
                                aria-label="หน่วยรับเข้า"
                                value={row.purchaseUomCode || "PCS"}
                                disabled={isBusy}
                                title={factor > 1 ? `ตัวคูณ x${factor}` : undefined}
                                className="h-8 max-w-[4.5rem] truncate rounded bg-slate-100 px-1 text-xs"
                                onChange={(event) => {
                                  const next = purchaseUoms.find(
                                    (item) => item.uom_code === event.target.value,
                                  );
                                  handlePurchaseUomChange(
                                    row.lineKey,
                                    event.target.value,
                                    resolveConversionFactor(next?.default_multiplier),
                                  );
                                }}
                              >
                                {purchaseUoms.map((item) => (
                                  <option key={item.uom_code} value={item.uom_code}>
                                    {item.uom_code}·{item.uom_name}
                                  </option>
                                ))}
                              </Select>
                            ) : (
                              <span className="rounded bg-slate-100 px-2 py-1 text-xs">
                                {uom
                                  ? `${uom.uom_code}·${uom.uom_name}`
                                  : row.purchaseUomCode || "PCS"}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="px-1 py-2 text-right">
                          <Input
                            type="number"
                            inputMode="decimal"
                            min="0"
                            step="0.0001"
                            value={row.isFoc ? 0 : Number(row.unit_price) || 0}
                            disabled={isBusy || row.isFoc}
                            onChange={(event) =>
                              handleUnitPriceChange(row.lineKey, event.target.value)
                            }
                            className="h-8 w-full px-2 text-right text-sm"
                            aria-label={`ราคาต่อหน่วย ${row.raw_vendor_sku || "รายการ"}`}
                          />
                        </TableCell>
                        <TableCell className="px-1 py-2 text-center text-xs font-medium text-amber-700">
                          {row.discount_text?.trim() || "-"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "px-1 py-2 text-right text-sm font-semibold tabular-nums",
                            row.isFoc ? "text-slate-400" : "text-emerald-600",
                          )}
                          title={
                            aiVatType === "INCLUSIVE"
                              ? "ทุนสุทธิต่อหน่วยฐานหลังถอด VAT 7% ตาม TAS 2"
                              : "ทุนสุทธิต่อหน่วยฐาน"
                          }
                        >
                          {row.isFoc ? "0.00" : formatMoney(displayNetUnitCost)}
                        </TableCell>
                        <TableCell className="px-1 py-2 text-right text-sm font-bold tabular-nums text-slate-900">
                          {formatMoney(displayTotalAmount)}
                        </TableCell>
                        <TableCell className="px-0.5 py-2 text-center">
                          <div className="flex items-center justify-center gap-0.5">
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 p-0"
                              disabled={isBusy}
                              title="คัดลอกแถว"
                              aria-label={`คัดลอกแถว ${row.raw_vendor_sku || "รายการ"}`}
                              onClick={() => duplicateReviewRow(row)}
                            >
                              <Copy className="size-3.5" aria-hidden />
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 p-0 text-red-600 hover:bg-red-50 hover:text-red-700"
                              disabled={isBusy}
                              title="ลบแถว"
                              aria-label={`ลบแถว ${row.raw_vendor_sku || "รายการ"}`}
                              onClick={() => deleteReviewRow(row.lineKey)}
                            >
                              <Trash2 className="size-3.5" aria-hidden />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              <div className="px-4 pt-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={addMissingReviewRow}
                  disabled={isOcrRunning}
                >
                  + เพิ่มรายการที่ตกหล่น (Add Missing Item)
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </section>

      {rows.length > 0 ? (
        <DualFreightFields
          carriers={carriers}
          onCarriersChange={setCarriers}
          freightCost={freightCostInput}
          onFreightCostChange={(value) => {
            setFreightCostInput(value);
            setVatTotalsManual(false);
            setGrandTouched(false);
          }}
          freightTaxMode={freightTaxMode}
          onFreightTaxModeChange={(mode) => {
            setFreightTaxMode(mode);
            setVatAmountTouched(false);
            setGrandTouched(false);
          }}
          destFreightCost={destFreightInput}
          onDestFreightCostChange={setDestFreightInput}
          carrierId={carrierId}
          onCarrierIdChange={setCarrierId}
          trackingNo={carrierTrackingNo}
          onTrackingNoChange={setCarrierTrackingNo}
          disabled={isSavingToLedger || isOcrRunning}
        />
      ) : null}

      {/* VAT summary (AI) — above sticky Save footer */}
      {rows.length > 0 ? (
        <Card className="border-violet-200 bg-violet-50/40">
          <CardContent className="space-y-0 p-4">
            <MixedTaxConflictBanner
              consensus={taxConsensus}
              confirmed={mixedTaxConfirmed}
              onConfirmedChange={setMixedTaxConfirmed}
            />
            <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-12">
              <div className="lg:col-span-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">
                  AI VAT ANALYSIS — ตรวจสอบก่อนบันทึก
                </p>
                <Label htmlFor="goods-receipt-tax-mode" className="mt-2 text-sm font-semibold text-slate-900">
                  โหมดภาษี
                </Label>
                <Select
                  id="goods-receipt-tax-mode"
                  value={vatTypeToPurchaseTaxMode(aiVatType)}
                  onChange={(event) =>
                    handleTaxModeChange(event.target.value as PurchaseTaxMode)
                  }
                  className="mt-1 h-9 w-full text-sm"
                  aria-label="โหมดภาษี"
                >
                  <option value="EXC_VAT">EXC_VAT — ภาษีนอก (+7% เพิ่มจากยอดบิล)</option>
                  <option value="INC_VAT">INC_VAT — ราคารวมภาษี (ถอด VAT 7% ในตัว)</option>
                  <option value="NON_VAT">NON_VAT — ไม่มีภาษี (0%)</option>
                </Select>
                <p className="mt-2 text-[11px] leading-relaxed text-emerald-700">
                  {taxConsensus.hasUnanimousConsensus &&
                  taxConsensus.consensusTaxType &&
                  vatTypeToPurchaseTaxMode(aiVatType) === taxConsensus.consensusTaxType
                    ? `✓ ตั้งค่าอัตโนมัติตามประเภทภาษีของสินค้าในบิล (${purchaseTaxModeLabel(taxConsensus.consensusTaxType)} ครบทุกบรรทัด)`
                    : taxModeSource === "product"
                      ? `ดึงอัตโนมัติจากสินค้า: ${vatTypeToPurchaseTaxMode(aiVatType)}`
                      : purchaseTaxModeHint(
                          taxModeSource,
                          vatTypeToPurchaseTaxMode(aiVatType),
                        )}
                  {" • เอกสาร: "}
                  {aiDocType}
                  {vatTotalsManual ? " • ใช้ยอดที่พิมพ์ทับ" : ""}
                </p>
                {showCalcModes ? (
                  <VendorCalcModeBar
                    mode={calcMode}
                    quotes={calcQuotes}
                    disabled={isSavingToLedger || isOcrRunning}
                    onChange={handleCalcModeChange}
                  />
                ) : null}
                {paperGrand || paperSubtotal ? (
                  <p className="mt-1 text-[11px] text-slate-500">
                    ยอดบนกระดาษ
                    {paperSubtotal ? ` ฐาน ${formatMoney(paperSubtotal)}` : ""}
                    {paperGrand ? ` สุทธิ ${formatMoney(paperGrand)}` : ""}
                  </p>
                ) : null}
                {taxConsensus.hasUnanimousConsensus && taxConsensus.consensusTaxType ? (
                  <TaxModeMismatchBanner
                    documentMode={vatTypeToPurchaseTaxMode(aiVatType)}
                    consensusTaxType={taxConsensus.consensusTaxType}
                    onApplyConsensus={applyProductTaxConsensus}
                  />
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5 lg:col-span-8">
                <div className="rounded-lg border border-violet-100 bg-white px-3 py-2">
                  <p className="text-[10px] font-medium text-slate-400">
                    Sub Total (สินค้า+ส่งต้นทาง)
                  </p>
                  <p className="mt-1 w-full min-w-[115px] text-right font-mono text-base font-semibold tabular-nums text-slate-900">
                    <span className="mr-1 text-xs font-normal text-slate-400">฿</span>
                    {formatMoney(vatPreview.total_amount)}
                  </p>
                </div>
                <div className="rounded-lg border border-violet-100 bg-white px-3 py-2">
                  <Label htmlFor="vat-net-before" className="text-[10px] font-medium text-slate-400">
                    ยอดก่อน VAT (ฐานภาษี)
                  </Label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-slate-400">
                      ฿
                    </span>
                    <Input
                      id="vat-net-before"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={netBeforeVatInput}
                      onChange={(e) => {
                        setVatTotalsManual(true);
                        setNetBeforeTouched(true);
                        setNetBeforeVatInput(e.target.value);
                      }}
                      onBlur={handlePreVatBlur}
                      className={cn(
                        VAT_MONEY_INPUT_CLASS,
                        "pl-7",
                        vatTotalsManual && "border-blue-300 bg-blue-50/40",
                      )}
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-violet-100 bg-white px-3 py-2">
                  <Label htmlFor="vat-amount" className="text-[10px] font-medium text-slate-400">
                    VAT Amount (7%)
                  </Label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-slate-400">
                      ฿
                    </span>
                    <Input
                      id="vat-amount"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={vatAmountInput}
                      onChange={(e) => handleVatAmountChange(e.target.value)}
                      className={cn(
                        VAT_MONEY_INPUT_CLASS,
                        "pl-7 text-violet-700",
                        vatTotalsManual && "border-blue-300 bg-blue-50/40",
                      )}
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-violet-100 bg-white px-3 py-2">
                  <p className="text-[10px] font-medium text-slate-400">ส่วนลดท้ายบิล</p>
                  <p className="mt-1 w-full min-w-[115px] text-right font-mono text-base font-semibold tabular-nums text-slate-900">
                    {billDiscountText?.trim() || "—"}
                  </p>
                  <p className="text-[10px] text-slate-400">(กระจายลง Total แล้ว)</p>
                </div>
                <div className="rounded-lg border border-violet-100 bg-white px-3 py-2">
                  <Label htmlFor="vat-grand-total" className="text-[10px] font-medium text-slate-400">
                    Grand Total (ตั้งหนี้ผู้ขาย)
                  </Label>
                  <div className="relative mt-1">
                    <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-slate-400">
                      ฿
                    </span>
                    <Input
                      id="vat-grand-total"
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      value={grandTotalInput}
                      onChange={(e) => {
                        setGrandTouched(true);
                        setVatTotalsManual(true);
                        setGrandTotalInput(e.target.value);
                      }}
                      onBlur={handleGrandBlur}
                      className={cn(
                        VAT_MONEY_INPUT_CLASS,
                        "pl-7",
                        vatTotalsManual && "border-blue-300 bg-blue-50/40",
                      )}
                    />
                  </div>
                  {Math.abs(roundingDifference) >= 0.005 ? (
                    <p className="mt-1 text-[11px] font-medium text-orange-600">
                      มีการปรับปัดเศษ: {roundingDifference > 0 ? "+" : ""}
                      {formatMoney(roundingDifference)} บาท
                      {Math.abs(roundingDifference) > 1 ? (
                        <span className="block text-[10px] text-orange-500">
                          (เกิน ±1.00 บาท — ตรวจสอบอีกครั้ง)
                        </span>
                      ) : null}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-dashed border-violet-200 pt-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-800">
                  สรุปต้นทุนรับเข้าคลังตามมาตรฐาน TAS 2 — Inventory Landed Cost
                </p>
                <div className="mt-2">
                  <VerificationRow
                    label={`มูลค่าสินค้าสุทธิ (ก่อน VAT) • ${totals.qty.toLocaleString("th-TH")} ตัว`}
                    amount={`฿${formatMoney(goodsExVatTotal)}`}
                  />
                  <VerificationRow
                    label="+ ค่าขนส่งต้นทาง (เข้าต้นทุนสินค้า)"
                    amount={`฿${formatMoney(originFreightInventory)}`}
                  />
                  <VerificationRow
                    label={`+ ค่าขนส่งเก็บปลายทาง (${destCarrierName})`}
                    amount={`฿${formatMoney(destFreightNormalized)}`}
                  />
                  <VerificationRow
                    label="รวมฐานต้นทุนเข้าคลังสุทธิ (Landed Cost Pool)"
                    amount={`฿${formatMoney(landedCostPool)}`}
                    strong
                  />
                  <p className="text-right text-[11px] text-slate-500">
                    เฉลี่ย ฿{formatMoney(landedUnitAverage)} / ตัว
                  </p>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-800">
                  สรุปยอดตั้งหนี้ผู้ขายและใบวางบิล — AP Invoice & Settlement
                </p>
                <div className="mt-2">
                  <VerificationRow
                    label="รวมรายการสินค้า"
                    amount={formatMoney(goodsExVatTotal)}
                  />
                  <VerificationRow
                    label={originFreightApLabel}
                    amount={formatMoney(freightCostNormalized)}
                  />
                  <VerificationRow
                    label="รวมเป็นเงิน (ฐานก่อน VAT)"
                    amount={formatMoney(receiptVat.preVatAmount)}
                  />
                  <VerificationRow
                    label={vatRowLabel}
                    amount={formatMoney(displayedVatAmount)}
                  />
                  <VerificationRow
                    label="ยอดสุทธิตั้งหนี้ผู้ขาย (Grand Total)"
                    amount={formatMoney(vendorGrandTotal)}
                    strong
                  />
                  <p className="text-right text-[11px] text-slate-500">
                    ({numberToThaiBaht(vendorGrandTotal)})
                  </p>
                </div>
                {destFreightNormalized > 0 ? (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    🚚 ค่าขนส่งปลายทาง (จ่ายแยกให้บริษัทขนส่ง ไม่รวมในหนี้ผู้ขาย): ฿
                    {formatMoney(destFreightNormalized)}
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Sticky summary footer — appears once there's something to save */}
      {rows.length > 0 && (
        <div className="sticky bottom-4 z-30 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 px-5 py-4 shadow-lg backdrop-blur sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Total Received Qty
              </p>
              <p className="text-lg font-bold text-slate-900">
                {totals.qty.toLocaleString("th-TH")}{" "}
                <span className="text-xs font-medium text-slate-400">ตัว</span>
              </p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                รายการรวม (ก่อนขนส่ง)
              </p>
              <p className="text-lg font-bold text-slate-900">
                ฿{formatMoney(totals.value)}
              </p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Sub Total (+ ขนส่ง)
              </p>
              <p className="text-lg font-bold text-slate-900">
                ฿{formatMoney(vatPreview.total_amount)}
              </p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Grand Total
              </p>
              <p className="text-lg font-bold text-emerald-700">
                ฿{formatMoney(
                  grandTouched
                    ? roundMoney2(parseMoneyInput(grandTotalInput))
                    : receiptVat.grandTotal,
                )}
              </p>
            </div>
            <div className="h-8 w-px bg-slate-200" />
            <div className="w-40">
              <Label
                htmlFor="bill-discount-text"
                className="text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                ส่วนลดท้ายบิล (%, บาท)
              </Label>
              <Input
                id="bill-discount-text"
                value={billDiscountText}
                onChange={(event) => handleBillDiscountChange(event.target.value)}
                placeholder="เช่น 40%, 1500"
                className="mt-1 h-9 text-sm"
              />
              <p className="mt-0.5 text-[10px] text-slate-400">เช่น 40%, 1500</p>
            </div>
            {stats.unmatched > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                <AlertTriangle className="size-3.5" aria-hidden />
                เหลือ {stats.unmatched.toLocaleString("th-TH")} รายการที่ยังไม่จับคู่
              </span>
            )}
          </div>
          <div className="flex flex-col items-stretch gap-2">
            <MixedTaxConflictBanner
              consensus={taxConsensus}
              confirmed={mixedTaxConfirmed}
              onConfirmedChange={setMixedTaxConfirmed}
              showConfirm={false}
            />
            <Button
            type="button"
            size="lg"
            className="bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500 sm:w-auto"
            disabled={!canSaveToLedger}
            onClick={handleOpenSaveDialog}
          >
            <PackageCheck className="size-4" aria-hidden />
            บันทึกรับสินค้าเข้าคลัง (Save to Ledger)
          </Button>
          </div>
        </div>
      )}

      <CarrierFreightSummaryDialog
        open={freightSummaryOpen}
        onOpenChange={setFreightSummaryOpen}
        carriers={carriers}
      />

      <SaveToLedgerDialog
        open={isSaveDialogOpen}
        onOpenChange={setIsSaveDialogOpen}
        vendorId={vendorId}
        vendorName={vendors.find((vendor) => vendor.id === vendorId)?.company_name ?? ""}
        initialDocNumber={ocrDocNumber}
        initialDocDate={ocrDocDate}
        initialBillDiscountText={billDiscountText}
        initialDocType={aiDocType}
        initialVatType={aiVatType}
        matchedCount={stats.matched}
        isSaving={isSavingToLedger}
        onConfirm={(payload) => void handleConfirmSaveToLedger(payload)}
      />

      <QuickCreateDialog
        open={quickCreateTarget !== null}
        onOpenChange={(open) => {
          if (!open) setQuickCreateTarget(null);
        }}
        vendorId={vendorId}
        vendorSkuHint={quickCreateTarget?.raw_vendor_sku ?? ""}
        onCreated={handleQuickProductCreated}
      />

      <FullMatrixDialog
        open={fullMatrixTarget !== null}
        onOpenChange={(open) => {
          if (!open) setFullMatrixTarget(null);
        }}
        vendorId={vendorId}
        vendorSkuHint={fullMatrixTarget?.raw_vendor_sku ?? ""}
      />
    </div>
  );
}
