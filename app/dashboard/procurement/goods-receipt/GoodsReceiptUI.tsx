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

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  PackageCheck,
  Sparkles,
  UploadCloud,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { getActiveVendors, type VendorOption } from "@/lib/actions/mapping";
import {
  createOnTheFlyReceiptMapping,
  getInternalProductsForMatching,
  matchReceiptItemsToProducts,
  parseReceiptOcr,
  saveGoodsReceiptToLedger,
  type ReceiptLineRow,
  type ReceiptProductSummary,
} from "@/lib/actions/receipt";
import {
  calculateNetCostApportionment,
  type ApportionmentItem,
} from "@/lib/utils/accounting";
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

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function StatusBadge({ status }: { status: ReceiptLineRow["status"] }) {
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

export default function GoodsReceiptUI() {
  /* Header — vendor */
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [vendorsError, setVendorsError] = useState<string | null>(null);
  const [isLoadingVendors, startVendorsTransition] = useTransition();

  /* Products for the on-the-fly Smart Combobox (Server Action, not client fetch) */
  const [products, setProducts] = useState<ReceiptProductSummary[]>([]);

  /* Upload zone */
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isOcrRunning, setIsOcrRunning] = useState(false);

  /** Document/invoice number Gemini extracted from the receipt header (editable at Save time). */
  const [ocrDocNumber, setOcrDocNumber] = useState("");
  /** Document/invoice date Gemini extracted from the receipt header (ISO `YYYY-MM-DD`, editable at Save time). */
  const [ocrDocDate, setOcrDocDate] = useState("");

  /** End-of-bill discount text (e.g. "40%", "1500") — fed into calculateNetCostApportionment. */
  const [billDiscountText, setBillDiscountText] = useState("");

  /** "Save to Ledger" confirmation dialog — final review + Early Warning duplicate check. */
  const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);

  /* Review table */
  const [rows, setRows] = useState<ReceiptLineRow[]>([]);
  const [draftProductByLineKey, setDraftProductByLineKey] = useState<
    Record<string, string>
  >({});
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
    startVendorsTransition(async () => {
      const result = await getActiveVendors();
      if (result.error) {
        setVendorsError(result.error);
        toast.error(result.error);
        return;
      }
      setVendorsError(null);
      setVendors(result.data);
    });
  }, []);

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

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function handleVendorChange(nextId: string) {
    setVendorId(nextId);
    // Mapping differs per vendor — clear stale review rows
    setRows([]);
    setDraftProductByLineKey({});
  }

  const clearInvoice = useCallback(() => {
    setPendingFile(null);
    setFileName("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setRows([]);
    setDraftProductByLineKey({});
    setOcrDocNumber("");
    setOcrDocDate("");
    setBillDiscountText("");
  }, [previewUrl]);

  /**
   * Drop/select a file — just stores the raw `File` in state + a local
   * preview URL. No Base64 conversion, no network call — `parseReceiptOcr`
   * receives the `File` itself via `FormData` (see `handleRunOcr`).
   */
  const handleFileSelected = useCallback(
    (file: File) => {
      setRows([]);
      setDraftProductByLineKey({});
      setOcrDocNumber("");
      setOcrDocDate("");
      setBillDiscountText("");
      setFileName(file.name);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(
        file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      );
      setPendingFile(file);
    },
    [previewUrl],
  );

  /** Explicit "Parse with AI" trigger — Step 1 (Gemini OCR) + Step 2 (match). */
  async function handleRunOcr() {
    if (!vendorId) {
      toast.error("เลือกผู้จำหน่าย (Vendor) ก่อนวิเคราะห์บิล");
      return;
    }
    if (!pendingFile) {
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
      formData.append("file", pendingFile);

      const parsed = await parseReceiptOcr(formData);
      if (parsed.error) {
        toast.error(parsed.error);
        setRows([]);
        return;
      }

      setOcrDocNumber(parsed.documentNumber ?? "");
      setOcrDocDate(parsed.documentDate ?? "");

      const matched = await matchReceiptItemsToProducts(vendorId, parsed.data);
      if (matched.error) {
        toast.error(matched.error);
        setRows([]);
        return;
      }

      setRows(matched.data);
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
      toast.success(
        (unmatchedCount > 0
          ? `AI วิเคราะห์สำเร็จ — พบ ${matched.data.length} รายการ (${unmatchedCount} ยังไม่จับคู่)`
          : `AI วิเคราะห์สำเร็จ — พบ ${matched.data.length} รายการ จับคู่ครบ`) +
          docNumberSuffix +
          docDateSuffix,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "วิเคราะห์บิลไม่สำเร็จ");
    } finally {
      setIsOcrRunning(false);
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

  /** "Confirm Mapping" — saves `raw_vendor_sku` as Ground Truth, then refreshes the row. */
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

    setConfirmingLineKey(row.lineKey);

    const result = await createOnTheFlyReceiptMapping({
      vendorId,
      vendorSku: row.raw_vendor_sku,
      vendorProductName: row.raw_description ?? product.name,
      internalProductId: productId,
    });

    setConfirmingLineKey(null);

    if (result.error || !result.product) {
      toast.error(result.error ?? "บันทึก mapping ไม่สำเร็จ");
      return;
    }

    setRows((current) =>
      current.map((item) =>
        item.lineKey === row.lineKey
          ? {
              ...item,
              status: "matched" as const,
              mappingId: result.mappingId,
              matchedProduct: result.product,
            }
          : item,
      ),
    );
    setDraftProductByLineKey((current) => {
      const next = { ...current };
      delete next[row.lineKey];
      return next;
    });
    toast.success(`บันทึก Ground Truth แล้ว: ${row.raw_vendor_sku} ↔ ${result.product.sku}`);
  }

  /** Toggle FOC (ของแถม) for a review-table row — drives calculateNetCostApportionment. */
  function handleToggleFoc(lineKey: string, isFoc: boolean) {
    setRows((current) =>
      current.map((row) => (row.lineKey === lineKey ? { ...row, isFoc } : row)),
    );
  }

  const stats = {
    total: rows.length,
    matched: rows.filter((row) => row.status === "matched").length,
    unmatched: rows.filter((row) => row.status === "unmatched").length,
  };

  /**
   * Live preview of Net Cost Apportionment — same engine the Server Action
   * uses on Save, so Total Document Value / per-row Net Cost stay in sync
   * with FOC toggles and bill-level discount before the user commits.
   */
  const apportionmentPreview = useMemo(() => {
    const items: ApportionmentItem[] = rows.map((row) => ({
      id: row.lineKey,
      unitPrice: Number(row.unit_price) || 0,
      qty: Math.max(0, Math.round(Number(row.qty) || 0)),
      discountText: row.discount_text,
      isFoc: Boolean(row.isFoc),
    }));
    return calculateNetCostApportionment(items, billDiscountText || null);
  }, [rows, billDiscountText]);

  const apportionmentByLineKey = useMemo(() => {
    return new Map(apportionmentPreview.map((result) => [result.id, result]));
  }, [apportionmentPreview]);

  const totals = {
    qty: rows.reduce((sum, row) => sum + (Number(row.qty) || 0), 0),
    value: apportionmentPreview.reduce(
      (sum, result) => sum + (Number(result.finalLineTotal) || 0),
      0,
    ),
  };

  const canSaveToLedger =
    rows.length > 0 && stats.unmatched === 0 && !isSavingToLedger && !isOcrRunning;

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
    // Sync bill discount from the dialog (user may have edited it there).
    setBillDiscountText(payload.billDiscountText);
    try {
      const result = await saveGoodsReceiptToLedger(
        rows,
        payload.docNumber,
        payload.docDate,
        payload.billDiscountText || null,
      );
      if (result.error || !result.docHeaderId) {
        toast.error(result.error ?? "บันทึกรับสินค้าเข้าคลังไม่สำเร็จ");
        return;
      }

      toast.success(
        `บันทึกรับสินค้าเข้าคลังสำเร็จ — เอกสาร ${result.docNo ?? result.docHeaderId} (${stats.matched.toLocaleString("th-TH")} รายการ)`,
      );
      setIsSaveDialogOpen(false);
      clearInvoice();
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
        <div className="flex flex-wrap gap-2">
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
                disabled={isLoadingVendors || isOcrRunning}
                isLoading={isLoadingVendors}
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
              onFileSelected={(file) => void handleFileSelected(file)}
              onClear={clearInvoice}
            />
            {pendingFile && (
              <Button
                type="button"
                onClick={() => void handleRunOcr()}
                disabled={!vendorId || !pendingFile || isOcrRunning}
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

              <Table className="min-w-[1180px]">
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    <TableHead>สถานะ</TableHead>
                    <TableHead>OCR Raw Text</TableHead>
                    <TableHead className="min-w-[280px]">
                      Matched Internal Product
                    </TableHead>
                    <TableHead className="text-center">ของแถม</TableHead>
                    <TableHead className="text-right">Qty</TableHead>
                    <TableHead className="text-right">Unit Price</TableHead>
                    <TableHead>Discount</TableHead>
                    <TableHead className="text-right">Net Cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => {
                    const isMatched = row.status === "matched";
                    const isBusy = confirmingLineKey === row.lineKey;
                    const draftProductId = draftProductByLineKey[row.lineKey] ?? "";
                    const preview = apportionmentByLineKey.get(row.lineKey);
                    const displayNetCost = row.isFoc
                      ? 0
                      : (preview?.finalUnitCost ?? row.netCost);

                    return (
                      <TableRow
                        key={row.lineKey}
                        className={cn(
                          isMatched && "bg-emerald-50/40",
                          !isMatched &&
                            "border-l-4 border-l-amber-400 bg-amber-50/60 hover:bg-amber-50",
                          row.isFoc && "bg-slate-50/80 text-slate-400",
                        )}
                      >
                        <TableCell>
                          <div className="flex flex-col gap-1">
                            <StatusBadge status={row.status} />
                            {row.isFoc ? (
                              <span className="inline-flex w-fit items-center rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold text-slate-600">
                                ของแถม (FOC)
                              </span>
                            ) : null}
                          </div>
                        </TableCell>

                        {/* OCR Raw Text — Ground Truth, never edited/predicted */}
                        <TableCell>
                          <p
                            className={cn(
                              "font-mono text-xs font-semibold",
                              row.isFoc ? "text-slate-400 line-through" : "text-slate-800",
                            )}
                          >
                            {row.raw_vendor_sku || "—"}
                          </p>
                          {row.raw_description ? (
                            <p className="mt-0.5 max-w-[200px] truncate text-[11px] text-slate-400">
                              {row.raw_description}
                            </p>
                          ) : null}
                        </TableCell>

                        {/* Matched Internal Product */}
                        <TableCell>
                          {isMatched && row.matchedProduct ? (
                            <div className="flex items-start gap-1.5">
                              <CheckCircle2
                                className="mt-0.5 size-4 shrink-0 text-emerald-600"
                                aria-hidden
                              />
                              <div className="min-w-0">
                                <p
                                  className={cn(
                                    "truncate text-sm font-semibold",
                                    row.isFoc ? "text-slate-400" : "text-emerald-700",
                                  )}
                                >
                                  {row.matchedProduct.name}
                                </p>
                                <p className="truncate font-mono text-[11px] text-slate-400">
                                  {row.matchedProduct.sku}
                                  {[row.matchedProduct.color, row.matchedProduct.size]
                                    .filter(Boolean)
                                    .length > 0
                                    ? ` · ${[row.matchedProduct.color, row.matchedProduct.size]
                                        .filter(Boolean)
                                        .join(" / ")}`
                                    : ""}
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1.5 rounded-lg border border-amber-300 bg-amber-100/70 p-2">
                              <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-800">
                                <AlertTriangle className="size-3.5 shrink-0" aria-hidden />
                                ไม่พบสินค้าที่ตรงกัน — เลือกสินค้าภายใน
                              </div>
                              <div className="flex items-center gap-1.5">
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
                                {draftProductId && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="icon"
                                    className="h-9 w-9 shrink-0 border-slate-300 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                                    disabled={isBusy}
                                    onClick={() => handleClearDraft(row.lineKey)}
                                    aria-label="ล้างการเลือกสินค้า"
                                    title="ล้างการเลือกสินค้า"
                                  >
                                    <X className="size-3.5" aria-hidden />
                                  </Button>
                                )}
                                <Button
                                  type="button"
                                  size="sm"
                                  className="h-9 shrink-0 bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500"
                                  disabled={!draftProductId || isBusy}
                                  onClick={() => void handleConfirmMapping(row)}
                                >
                                  {isBusy ? (
                                    "กำลังบันทึก..."
                                  ) : (
                                    <>
                                      <Check className="size-3.5" aria-hidden />
                                      Confirm
                                    </>
                                  )}
                                </Button>
                              </div>
                            </div>
                          )}
                        </TableCell>

                        <TableCell className="text-center">
                          <label className="inline-flex cursor-pointer flex-col items-center gap-1">
                            <input
                              type="checkbox"
                              checked={Boolean(row.isFoc)}
                              onChange={(event) =>
                                handleToggleFoc(row.lineKey, event.target.checked)
                              }
                              className="size-4 rounded border-slate-300 text-slate-700 focus:ring-slate-400"
                              aria-label={`ของแถม ${row.raw_vendor_sku}`}
                            />
                            <span className="text-[10px] font-medium text-slate-500">
                              ของแถม
                            </span>
                          </label>
                        </TableCell>

                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            row.isFoc && "text-slate-400",
                          )}
                        >
                          {row.qty.toLocaleString("th-TH")}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            row.isFoc && "text-slate-400 line-through",
                          )}
                        >
                          {formatMoney(row.unit_price)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "font-mono text-xs",
                            row.isFoc ? "text-slate-400" : "text-slate-600",
                          )}
                        >
                          {row.discount_text?.trim() || "—"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-semibold tabular-nums",
                            row.isFoc
                              ? "text-slate-400"
                              : isMatched
                                ? "text-emerald-700"
                                : "text-amber-800",
                          )}
                        >
                          {row.isFoc ? "0.00" : formatMoney(displayNetCost)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        )}
      </section>

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
                Total Document Value
              </p>
              <p className="text-lg font-bold text-slate-900">
                ฿{formatMoney(totals.value)}
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
                onChange={(event) => setBillDiscountText(event.target.value)}
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
      )}

      <SaveToLedgerDialog
        open={isSaveDialogOpen}
        onOpenChange={setIsSaveDialogOpen}
        vendorId={vendorId}
        initialDocNumber={ocrDocNumber}
        initialDocDate={ocrDocDate}
        initialBillDiscountText={billDiscountText}
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
