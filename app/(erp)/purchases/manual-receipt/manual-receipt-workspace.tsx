"use client";

/**
 * Manual Goods Receipt workspace — Client island.
 * Persistence via `saveManualGoodsReceipt` Server Action only (no client Supabase).
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  PackagePlus,
  Trash2,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import type { VendorOption } from "@/lib/actions/mapping";
import { getManualReceiptVendorContext } from "@/lib/actions/manual-receipt-context";
import { checkDuplicateInvoice, saveManualGoodsReceipt } from "@/lib/actions/receipt";
import { loadVendorUsesTemporaryBill } from "@/lib/actions/vendor-tax-invoice";
import { uploadProcurementBills } from "@/lib/procurement/upload-bill-files";
import { BillAttachmentPicker } from "@/components/procurement/bill-attachment-picker";
import { TaxInvoiceStatusPicker } from "@/components/procurement/tax-invoice-status-picker";
import {
  suggestReceiptTaxInvoiceStatus,
  type ReceiptTaxInvoiceChoice,
} from "@/lib/utils/tax-invoice-status";
import type { GoodsReceiptDocType } from "@/lib/constants/document";
import {
  calculateNetCostApportionment,
  type ApportionmentItem,
} from "@/lib/utils/accounting";
import { type VatCalculationType } from "@/lib/utils/document-summary";
import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import {
  vatTypeToPurchaseTaxMode,
  purchaseTaxModeToVatType,
  analyzeLineItemsTaxConsensus,
  minorityTaxModes,
  normalizePurchaseTaxMode,
  purchaseTaxModeLabel,
  type PurchaseTaxMode,
} from "@/lib/utils/purchase-tax";
import {
  MixedTaxConflictBanner,
  TaxModeMismatchBanner,
} from "@/components/procurement/purchase-tax-guardrails";
import { VendorCalcModeBar } from "@/components/procurement/vendor-calc-mode-bar";
import {
  loadVendorRoundingCalcMode,
  saveVendorRoundingCalcMode,
} from "@/lib/actions/vendor-rounding";
import {
  calculateVendorLineTotals,
  quoteVendorCalcModes,
  roundMoney2,
  vendorCalcSpread,
  type VendorCalcMode,
} from "@/lib/utils/vendor-calc-mode";
import { calculateLandedCost, resolveFreightExVat } from "@/lib/utils/landed-cost";
import {
  computeVendorPayable,
  type FreightTaxMode,
} from "@/lib/utils/dual-freight";
import type { CarrierOption } from "@/types/carrier";
import type { PrintCompanyProfile } from "@/types/print-document";
import type { PurchaseCloneDraft } from "@/types/purchase-document-control";
import type { ProcurementBillSet } from "@/types/procurement-bills";
import { DualFreightFields } from "@/components/procurement/DualFreightFields";
import { CarrierFreightSummaryDialog } from "@/components/procurement/CarrierFreightSummaryDialog";
import type { SalesProductSearchItem } from "@/types/document";
import type { VendorMappedReceiptProduct } from "@/types/manual-receipt";
import { ManualReceiptPreviewDialog } from "@/app/(erp)/purchases/manual-receipt/manual-receipt-preview-dialog";
import SmartSkuPicker, {
  type SmartSkuPickerHandle,
} from "@/components/sales/smart-sku-picker";
import VendorCombobox from "@/components/procurement/VendorCombobox";
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
import { cn } from "@/lib/utils";
import { InventoryLandedCostCard } from "@/components/procurement/inventory-landed-cost-card";
import { PurchaseUomCell } from "@/components/procurement/PurchaseUomCell";
import { buildReceiptQtySummary } from "@/lib/utils/receipt-qty-groups";
import {
  defaultPurchaseUom,
  netUnitCostPerBase,
  resolveConversionFactor,
  stockBaseQty,
  type PurchaseUomOption,
} from "@/lib/utils/purchase-uom";

export type ManualReceiptLine = {
  key: string;
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  unit_cost: number;
  purchaseUomCode: string;
  conversionFactor: number;
  isFoc: boolean;
  vendorSku: string;
  taxType?: string | null;
  baseUom?: string | null;
  sizeLabel?: string | null;
  isRawMaterial?: boolean | null;
};

export type ManualReceiptWorkspaceProps = {
  vendors: VendorOption[];
  vendorsError: string | null;
  purchaseUoms: PurchaseUomOption[];
  initialCarriers: CarrierOption[];
  company: PrintCompanyProfile;
  cloneDraft?: PurchaseCloneDraft | null;
  cloneError?: string | null;
};

const DOC_TYPE_OPTIONS: { value: GoodsReceiptDocType; label: string }[] = [
  {
    value: "AP_TAX",
    label: "ใบส่งของ/ใบกำกับภาษี (ตั้งหนี้) — AP_TAX",
  },
  {
    value: "AP_INV",
    label: "ใบส่งของ/บิลธรรมดา (ตั้งหนี้ Non-VAT) — AP_INV",
  },
  {
    value: "AP_CASH",
    label: "บิลเงินสด/ใบกำกับภาษี (จ่ายทันที) — AP_CASH",
  },
];


const selectClassName = cn(
  "flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition",
  "focus:border-blue-400 focus:ring-2 focus:ring-blue-100",
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
);

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export default function ManualReceiptWorkspace({
  vendors,
  vendorsError,
  purchaseUoms,
  initialCarriers,
  company,
  cloneDraft = null,
  cloneError = null,
}: ManualReceiptWorkspaceProps) {
  const router = useRouter();
  const skuPickerRef = useRef<SmartSkuPickerHandle>(null);
  const lastRowRef = useRef<HTMLTableRowElement>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);
  const [focusLineKey, setFocusLineKey] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [, startDefaults] = useTransition();
  const [billFiles, setBillFiles] = useState<File[]>([]);
  const [cloneBillUrls, setCloneBillUrls] = useState<string[]>(
    cloneDraft?.billUrls ?? [],
  );
  const [vendorProducts, setVendorProducts] = useState<VendorMappedReceiptProduct[]>([]);
  const [defaultHint, setDefaultHint] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const [vendorId, setVendorId] = useState(cloneDraft?.vendorId ?? "");
  const [docDate, setDocDate] = useState(
    cloneDraft?.docDate?.slice(0, 10) || todayIsoDate(),
  );
  const [documentRef, setDocumentRef] = useState(cloneDraft?.documentRef ?? "");
  const [invoiceGuard, setInvoiceGuard] = useState<{
    isDuplicate: boolean;
    isChecking: boolean;
    voidedDocNo: string | null;
  }>({ isDuplicate: false, isChecking: false, voidedDocNo: null });
  const [docType, setDocType] = useState<GoodsReceiptDocType>(
    cloneDraft?.docType ?? "AP_TAX",
  );
  const [taxInvoiceStatus, setTaxInvoiceStatus] = useState<ReceiptTaxInvoiceChoice>(
    suggestReceiptTaxInvoiceStatus({ referenceNo: cloneDraft?.documentRef }),
  );
  const [taxStatusLocked, setTaxStatusLocked] = useState(false);
  const [vendorUsesTemporaryBill, setVendorUsesTemporaryBill] = useState(false);
  const [vatType, setVatType] = useState<VatCalculationType>(
    cloneDraft?.vatType ?? "NONE",
  );
  const [taxModeLocked, setTaxModeLocked] = useState(false);
  const [mixedTaxConfirmed, setMixedTaxConfirmed] = useState(false);
  const [discountText, setDiscountText] = useState(cloneDraft?.discountText ?? "");
  const [calcMode, setCalcMode] = useState<VendorCalcMode>("LINE_2DEC");
  const [pennyDelta, setPennyDelta] = useState(0);
  const [roundingGap, setRoundingGap] = useState(0);
  const [freightCostInput, setFreightCostInput] = useState(
    cloneDraft && cloneDraft.freightCost > 0 ? String(cloneDraft.freightCost) : "",
  );
  const [freightTaxMode, setFreightTaxMode] = useState<FreightTaxMode>(
    cloneDraft?.freightTaxMode === "SEPARATE_NON_VAT"
      ? "SEPARATE_NON_VAT"
      : "INCLUDED_IN_TAX",
  );
  const [destFreightInput, setDestFreightInput] = useState(
    cloneDraft && cloneDraft.destFreightCost > 0
      ? String(cloneDraft.destFreightCost)
      : "",
  );
  const [carrierId, setCarrierId] = useState("");
  const [carrierTrackingNo, setCarrierTrackingNo] = useState("");
  const [carriers, setCarriers] = useState(initialCarriers);
  const [freightSummaryOpen, setFreightSummaryOpen] = useState(false);
  const [lines, setLines] = useState<ManualReceiptLine[]>(
    cloneDraft?.lines ?? [],
  );

  useEffect(() => {
    if (cloneError) toast.error(cloneError);
  }, [cloneError]);

  useEffect(() => {
    if (!focusLineKey) return;
    const frame = window.requestAnimationFrame(() => {
      lastRowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      qtyInputRef.current?.focus();
      qtyInputRef.current?.select();
      setFocusLineKey(null);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusLineKey, lines]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.altKey !== true || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.code !== "KeyA") return;
      if (isPending || previewOpen || freightSummaryOpen) return;
      event.preventDefault();
      skuPickerRef.current?.openAndFocus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [freightSummaryOpen, isPending, previewOpen]);

  useEffect(() => {
    const vendor = cloneDraft?.vendorId;
    if (!vendor) return;
    startDefaults(async () => {
      const result = await getManualReceiptVendorContext(vendor);
      if (result.data) setVendorProducts(result.data.products);
    });
  }, [cloneDraft?.vendorId]);

  const costPreviewByKey = useMemo(() => {
    const items: ApportionmentItem[] = lines.map((line) => ({
      id: line.key,
      unitPrice: Number(line.unit_cost) || 0,
      qty: Number(line.qty) || 0,
      isFoc: line.isFoc,
    }));
    return new Map(
      calculateNetCostApportionment(items, discountText || null, {
        vatType,
        vatRate: vatType === "NONE" ? 0 : 7,
      }).map((row) => [row.id, row]),
    );
  }, [lines, discountText, vatType]);

  const calcQuotes = useMemo(
    () =>
      quoteVendorCalcModes(
        lines.map((line) => ({
          id: line.key,
          unitPrice: Number(line.unit_cost) || 0,
          qty: Number(line.qty) || 0,
          isFoc: line.isFoc,
        })),
        discountText,
        vatType === "INCLUSIVE" || vatType === "EXCLUSIVE" ? vatType : "NONE",
      ),
    [lines, discountText, vatType],
  );
  const showCalcModes = vendorCalcSpread(calcQuotes) >= 0.01;

  const invoicePreviewByKey = useMemo(() => {
    const totalsById = calculateVendorLineTotals(
      lines.map((line) => ({
        id: line.key,
        unitPrice: Number(line.unit_cost) || 0,
        qty: Number(line.qty) || 0,
        isFoc: line.isFoc,
      })),
      discountText,
      calcMode,
    );
    if (pennyDelta) {
      const last = [...lines].reverse().find((line) => !line.isFoc);
      const row = totalsById.find((item) => item.id === last?.key);
      if (row) row.lineTotal = roundMoney2(row.lineTotal + pennyDelta);
    }
    return new Map(totalsById.map((row) => [row.id, { finalLineTotal: row.lineTotal }]));
  }, [lines, discountText, calcMode, pennyDelta]);

  const totals = useMemo(() => {
    let qty = 0;
    let gross = 0;
    let netCost = 0;
    for (const line of lines) {
      qty += stockBaseQty(line.qty, line.conversionFactor);
      if (!line.isFoc) {
        gross += (Number(line.qty) || 0) * (Number(line.unit_cost) || 0);
      }
      netCost += Number(costPreviewByKey.get(line.key)?.finalLineTotal ?? 0);
    }
    return {
      qty,
      gross: roundMoney(gross),
      netCost: roundMoney(netCost),
    };
  }, [lines, costPreviewByKey]);

  const freightCostNormalized = useMemo(
    () => roundMoney(Math.max(0, Number(freightCostInput) || 0)),
    [freightCostInput],
  );

  const freightByKey = useMemo(() => {
    return new Map(
      calculateLandedCost(
        freightCostNormalized,
        lines.map((line) => ({
          id: line.key,
          qty: Number(line.qty) || 0,
          lineNetAmount: Number(costPreviewByKey.get(line.key)?.finalLineTotal ?? 0),
          unitNetCost: Number(costPreviewByKey.get(line.key)?.finalUnitCost ?? 0),
          isFoc: line.isFoc,
        })),
        {
          vatType,
          vatRate: vatType === "NONE" ? 0 : 7,
          freightTaxMode,
          destFreightCost: roundMoney(Math.max(0, Number(destFreightInput) || 0)),
        },
      ).map((row) => [row.id, row.proratedFreight]),
    );
  }, [lines, costPreviewByKey, freightCostNormalized, destFreightInput, freightTaxMode, vatType]);

  const documentSummary = useMemo(() => {
    const goodsNet = lines.reduce(
      (sum, line) => sum + (invoicePreviewByKey.get(line.key)?.finalLineTotal ?? 0),
      0,
    );
    const payable = computeVendorPayable({
      goodsNet,
      originFreight: freightCostNormalized,
      freightTaxMode,
      vatType,
    });
    return {
      ...payable,
      discount_amount: 0,
      total_amount: roundMoney(
        goodsNet + (freightTaxMode === "SEPARATE_NON_VAT" ? 0 : freightCostNormalized),
      ),
    };
  }, [lines, invoicePreviewByKey, freightCostNormalized, freightTaxMode, vatType]);

  const destFreightNormalized = useMemo(
    () => roundMoney(Math.max(0, Number(destFreightInput) || 0)),
    [destFreightInput],
  );
  const billDiscount = useMemo(() => {
    const afterDiscount = lines.reduce(
      (sum, line) => sum + Number(invoicePreviewByKey.get(line.key)?.finalLineTotal ?? 0),
      0,
    );
    return roundMoney(Math.max(0, totals.gross - afterDiscount));
  }, [lines, invoicePreviewByKey, totals.gross]);
  const goodsAfterDiscount = roundMoney(Math.max(0, totals.gross - billDiscount));
  const goodsExVatTotal =
    vatType === "INCLUSIVE" ? roundMoney(goodsAfterDiscount / 1.07) : goodsAfterDiscount;
  const originFreightInventory =
    freightTaxMode === "SEPARATE_NON_VAT"
      ? freightCostNormalized
      : roundMoney(resolveFreightExVat(freightCostNormalized, vatType, vatType === "NONE" ? 0 : 7));
  const landedCostPool = roundMoney(
    goodsExVatTotal + originFreightInventory + destFreightNormalized,
  );
  const qtySummary = useMemo(
    () =>
      buildReceiptQtySummary(
        lines.map((line) => {
          const grossLine = line.isFoc
            ? 0
            : Number(invoicePreviewByKey.get(line.key)?.finalLineTotal ?? 0);
          const uom = purchaseUoms.find((item) => item.uom_code === line.purchaseUomCode);
          return {
            qty: line.qty,
            conversionFactor: line.conversionFactor,
            purchaseUomCode: line.purchaseUomCode,
            purchaseUomName: uom?.uom_name ?? null,
            baseUom: line.baseUom ?? uom?.uom_name ?? null,
            size: line.sizeLabel ?? null,
            isRawMaterial: line.isRawMaterial,
            exVatAmount: vatType === "INCLUSIVE" ? grossLine / 1.07 : grossLine,
            freightShare: freightByKey.get(line.key) ?? 0,
          };
        }),
        formatMoney,
        goodsExVatTotal,
      ),
    [lines, invoicePreviewByKey, purchaseUoms, vatType, freightByKey, goodsExVatTotal],
  );
  const selectedVendor = vendors.find((vendor) => vendor.id === vendorId);
  const destCarrierName =
    carriers.find((carrier) => carrier.carrier_id === carrierId)?.carrier_name ??
    "ยังไม่เลือกบริษัทขนส่ง";
  const originFreightApLabel =
    freightTaxMode === "SEPARATE_NON_VAT"
      ? "ค่าขนส่งต้นทาง (ชำระแยก Non-VAT)"
      : "ค่าขนส่งต้นทาง (ผู้ขายเรียกเก็บในบิล)";

  function handleVendorChange(nextId: string) {
    setVendorId(nextId);
    setVendorProducts([]);
    setDefaultHint("");
    setTaxModeLocked(false);
    setTaxStatusLocked(false);
    setVendorUsesTemporaryBill(false);
    if (nextId) {
      void loadVendorUsesTemporaryBill(nextId).then((result) => {
        setVendorUsesTemporaryBill(result.usesTemporaryBill);
      });
    }
    if (!nextId) return;
    startDefaults(async () => {
      const result = await getManualReceiptVendorContext(nextId);
      if (result.error || !result.data) {
        if (result.error) toast.error(result.error);
        return;
      }
      setVendorProducts(result.data.products);
      if (result.data.docType) setDocType(result.data.docType);
      if (result.data.vatType) setVatType(result.data.vatType);
      if (result.data.freightTaxMode) setFreightTaxMode(result.data.freightTaxMode);
      setDefaultHint(result.data.source);
      const remembered = await loadVendorRoundingCalcMode(nextId);
      if (!remembered.error) setCalcMode(remembered.mode);
    });
  }

  function handleSelectProduct(product: SalesProductSearchItem) {
    if (product.is_service) {
      toast.error(
        "ไม่สามารถรับงานบริการ (Service) เข้าคลัง — เลือกวัตถุดิบหรือสินค้าสำเร็จรูป",
      );
      return;
    }

    let nextFocusKey = "";
    setLines((current) => {
      const existing = current.find((row) => row.product_id === product.id);
      if (existing) {
        nextFocusKey = existing.key;
        return current.map((row) =>
          row.product_id === product.id
            ? { ...row, qty: row.qty + 1 }
            : row,
        );
      }
      const mapped = product as VendorMappedReceiptProduct;
      const mappedUom = mapped.purchase_uom_code
        ? purchaseUoms.find((item) => item.uom_code === mapped.purchase_uom_code)
        : undefined;
      const purchaseUom = mappedUom
        ? {
            uomCode: mappedUom.uom_code,
            conversionFactor: resolveConversionFactor(
              mapped.conversion_factor ?? mappedUom.default_multiplier,
            ),
          }
        : defaultPurchaseUom(purchaseUoms, product.base_uom);
      nextFocusKey = `${product.id}-${Date.now()}`;
      return [
        ...current,
        {
          key: nextFocusKey,
          product_id: product.id,
          sku: product.sku,
          name: product.display_name,
          qty: 1,
          unit_cost: roundMoney(Number(product.cost_price) || 0),
          purchaseUomCode: purchaseUom.uomCode,
          conversionFactor: purchaseUom.conversionFactor,
          isFoc: false,
          vendorSku: mapped.vendor_sku ?? "",
          taxType: product.tax_type ?? null,
          baseUom: product.base_uom,
          sizeLabel: product.size_label,
          isRawMaterial: product.is_raw_material ?? null,
        },
      ];
    });
    if (nextFocusKey) setFocusLineKey(nextFocusKey);
    toast.success(`เพิ่ม ${product.sku} ลงรายการแล้ว`);
  }

  function updateLine(
    key: string,
    patch: Partial<
      Pick<
        ManualReceiptLine,
        "qty" | "unit_cost" | "purchaseUomCode" | "conversionFactor" | "isFoc"
      >
    >,
  ) {
    setLines((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((row) => row.key !== key));
  }

  function validateForm(): boolean {
    if (!vendorId) {
      toast.error("กรุณาเลือกผู้จำหน่าย (Vendor)");
      return false;
    }
    if (!documentRef.trim()) {
      toast.error("กรุณากรอกเลขที่เอกสารอ้างอิง (Vendor Ref No.)");
      return false;
    }
    if (lines.length === 0) {
      toast.error("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ");
      return false;
    }
    if (destFreightNormalized > 0 && !carrierId) {
      toast.error("ค่าขนส่งปลายทางต้องเลือกบริษัทขนส่ง");
      return false;
    }
    for (const [index, line] of lines.entries()) {
      if (!Number.isFinite(line.qty) || line.qty <= 0) {
        toast.error(`รายการที่ ${index + 1}: จำนวนต้องมากกว่า 0`);
        return false;
      }
      if (!line.isFoc && (!Number.isFinite(line.unit_cost) || line.unit_cost < 0)) {
        toast.error(`รายการที่ ${index + 1}: ต้นทุนต่อหน่วยไม่ถูกต้อง`);
        return false;
      }
    }
    return true;
  }

  function existingCloneBills(): ProcurementBillSet | null {
    if (cloneBillUrls.length === 0) return null;
    const attachments = cloneBillUrls.map((url, index) => ({
      name: `บิลเดิม-${index + 1}`,
      path: url,
      url,
      type: "image",
      size: 0,
      uploaded_at: new Date().toISOString(),
    }));
    return { attachment_urls: [...cloneBillUrls], attachments };
  }

  function postReceipt() {
    startTransition(async () => {
      let bills = existingCloneBills();
      if (billFiles.length > 0) {
        const uploaded = await uploadProcurementBills(billFiles, documentRef.trim());
        if (uploaded.error || !uploaded.data) {
          toast.error(uploaded.error ?? "อัปโหลดรูปบิลไม่สำเร็จ");
          return;
        }
        bills = bills
          ? {
              attachment_urls: [
                ...bills.attachment_urls,
                ...uploaded.data.attachment_urls,
              ],
              attachments: [...bills.attachments, ...uploaded.data.attachments],
            }
          : uploaded.data;
      }
      const result = await saveManualGoodsReceipt({
        vendorId,
        docDate,
        documentRef: documentRef.trim(),
        bills,
        docType,
        vatType,
        discountText: discountText.trim() || null,
        calcMode,
        pennyDelta,
        roundingDifference: roundingGap,
        freightCost: freightCostNormalized,
        freightTaxMode,
        destFreightCost: destFreightNormalized,
        carrierId: carrierId || null,
        carrierTrackingNo: carrierTrackingNo || null,
        status: "ISSUED",
        taxInvoiceStatus,
        lines: lines.map((line, index) => ({
          product_id: line.product_id,
          qty: line.qty,
          unit_cost: line.unit_cost,
          description: line.name,
          sku: line.sku,
          purchaseUomCode: line.purchaseUomCode,
          conversionFactor: line.conversionFactor,
          isFoc: line.isFoc,
          sort_order: index + 1,
        })),
      });

      if (!result.data) {
        toast.error(result.error ?? "บันทึกรับสินค้าไม่สำเร็จ");
        return;
      }
      if (result.error) {
        toast.error(result.error);
      }

      toast.success(
        `รับสินค้าเข้าคลังสำเร็จ — ${result.data.doc_no}` +
          ` · ตัดเข้า ${result.data.ledger_count} รายการ · อัปเดต LPP (Net Cost) แล้ว`,
      );
      const remembered = await saveVendorRoundingCalcMode(vendorId, calcMode);
      if (remembered.error) toast.error(remembered.error);
      setPreviewOpen(false);
      router.push(
        `/purchases/${encodeURIComponent(result.data.doc_no)}?view=form&paper=A5-Portrait`,
      );
    });
  }

  const taxConsensus = useMemo(
    () =>
      analyzeLineItemsTaxConsensus(
        lines.map((line, index) => ({
          lineNo: index + 1,
          taxType: line.taxType,
          matched: true,
        })),
      ),
    [lines],
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
    if (taxModeLocked) return;
    if (!taxConsensus.hasUnanimousConsensus || !taxConsensus.consensusTaxType) return;
    const nextVat = purchaseTaxModeToVatType(taxConsensus.consensusTaxType);
    if (nextVat !== vatType) setVatType(nextVat);
  }, [taxConsensus, taxModeLocked, vatType]);

  function handleCalcModeChange(mode: VendorCalcMode) {
    setCalcMode(mode);
    setPennyDelta(0);
    setRoundingGap(0);
    if (!vendorId) return;
    void saveVendorRoundingCalcMode(vendorId, mode).then((result) => {
      if (result.error) toast.error(result.error);
    });
  }

  function balanceManualPenny(delta: number, gap: number) {
    const pennies = roundMoney2(delta);
    if (!pennies) return;
    if (Math.abs(pennies) > 0.1) {
      toast.warning("ปรับเศษได้ครั้งละไม่เกิน ±0.10 บาท");
      return;
    }
    setPennyDelta(pennies);
    setRoundingGap(roundMoney2(gap));
  }

  function applyProductTaxConsensus() {
    if (!taxConsensus.consensusTaxType) return;
    setVatType(purchaseTaxModeToVatType(taxConsensus.consensusTaxType));
    setTaxModeLocked(false);
  }

  useEffect(() => {
    const trimmedRef = documentRef.trim();
    const trimmedDate = docDate.trim();
    if (!vendorId || !trimmedRef || !trimmedDate) {
      setInvoiceGuard({ isDuplicate: false, isChecking: false, voidedDocNo: null });
      return;
    }

    let cancelled = false;
    setInvoiceGuard((current) => ({ ...current, isChecking: true }));
    const timer = setTimeout(() => {
      void checkDuplicateInvoice(vendorId, trimmedRef, trimmedDate).then((result) => {
        if (cancelled) return;
        if (result.error) {
          setInvoiceGuard({ isDuplicate: false, isChecking: false, voidedDocNo: null });
          return;
        }
        setInvoiceGuard({
          isDuplicate: result.isDuplicate,
          isChecking: false,
          voidedDocNo: result.voidedDocNo,
        });
      });
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [vendorId, documentRef, docDate]);

  useEffect(() => {
    if (taxStatusLocked) return;
    setTaxInvoiceStatus(
      suggestReceiptTaxInvoiceStatus({
        referenceNo: documentRef,
        vendorName: selectedVendor?.company_name,
        vendorUsesTemporaryBill,
      }),
    );
  }, [documentRef, selectedVendor?.company_name, vendorUsesTemporaryBill, taxStatusLocked]);

  function handleReview() {
    if (!validateForm()) return;
    if (invoiceGuard.isDuplicate || invoiceGuard.isChecking) return;
    if (taxConsensus.hasMixedTaxConflict && !mixedTaxConfirmed) return;
    setPreviewOpen(true);
  }

  const canSave =
    Boolean(vendorId) &&
    Boolean(documentRef.trim()) &&
    lines.length > 0 &&
    !isPending &&
    !invoiceGuard.isDuplicate &&
    !invoiceGuard.isChecking &&
    (!taxConsensus.hasMixedTaxConflict || mixedTaxConfirmed);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      {cloneDraft ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          คัดลอกจากเอกสารที่ยกเลิก {cloneDraft.sourceDocNo} — ตรวจรายการแล้วออกใบใหม่
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <Warehouse className="size-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              รับสินค้าเข้าคลัง (Manual)
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              มาตรฐานเดียวกับ OCR — หัวเอกสารครบ + Apportionment Math (VAT / ส่วนลด)
              ก่อนอัปเดต LPP
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/purchases"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <ArrowLeft className="size-4" />
            รายการเอกสารซื้อ
          </Link>
          <Button type="button" variant="outline" onClick={() => setFreightSummaryOpen(true)}>
            สรุปค่าขนส่งปลายทาง (ขอใบเสร็จ)
          </Button>
          <Link
            href="/dashboard/procurement/goods-receipt"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            รับด้วย OCR
          </Link>
        </div>
      </div>

      {vendorsError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          โหลดรายการ Vendor ไม่สำเร็จ: {vendorsError}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <Card className="border-slate-200 shadow-sm lg:col-span-7">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">หัวเอกสาร</CardTitle>
            <CardDescription>
              ผู้จำหน่าย · วันที่ · เลขอ้างอิง · ประเภทเอกสาร
              {defaultHint ? ` · ${defaultHint}` : ""}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>ผู้จำหน่าย (Vendor)</Label>
              <VendorCombobox
                options={vendors}
                value={vendorId}
                onChange={handleVendorChange}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-receipt-date">วันที่เอกสาร</Label>
              <Input
                id="manual-receipt-date"
                type="date"
                value={docDate}
                onChange={(e) => setDocDate(e.target.value)}
                disabled={isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="manual-receipt-ref">
                เลขที่เอกสารอ้างอิง (Vendor Ref No.) *
              </Label>
              <Input
                id="manual-receipt-ref"
                value={documentRef}
                onChange={(e) => setDocumentRef(e.target.value)}
                placeholder="เช่น INV-2401-001"
                disabled={isPending}
                autoComplete="off"
                required
              />
              {invoiceGuard.isDuplicate ? (
                <p className="text-xs font-semibold text-red-700">
                  ⚠️ บิลเลขที่และวันที่นี้ ถูกบันทึกเข้าระบบแล้ว
                </p>
              ) : invoiceGuard.voidedDocNo ? (
                <p className="text-xs font-medium text-sky-700">
                  ℹ️ พบบิลเลขที่นี้ที่ถูกยกเลิกไปแล้ว ({invoiceGuard.voidedDocNo}) ระบบพร้อมออกเอกสารใบใหม่ทดแทน
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="manual-receipt-doc-type">ประเภทเอกสาร</Label>
              <select
                id="manual-receipt-doc-type"
                value={docType}
                onChange={(e) => setDocType(e.target.value as GoodsReceiptDocType)}
                disabled={isPending}
                className={selectClassName}
              >
                {DOC_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="sm:col-span-2">
              <TaxInvoiceStatusPicker
                value={taxInvoiceStatus}
                disabled={isPending}
                onChange={(next) => {
                  setTaxStatusLocked(true);
                  setTaxInvoiceStatus(next);
                }}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">รูปบิล / เอกสารอ้างอิง</CardTitle>
          </CardHeader>
          <CardContent>
            {cloneBillUrls.length > 0 ? (
              <ul className="mb-3 space-y-1 text-sm">
                {cloneBillUrls.map((url) => (
                  <li key={url} className="flex items-center justify-between gap-2">
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-blue-700 underline"
                    >
                      รูปบิลเดิม
                    </a>
                    <button
                      type="button"
                      className="text-xs text-slate-500 hover:text-red-600"
                      onClick={() =>
                        setCloneBillUrls((current) =>
                          current.filter((item) => item !== url),
                        )
                      }
                    >
                      เอาออก
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <BillAttachmentPicker
              compact
              files={billFiles}
              onChange={setBillFiles}
              disabled={isPending}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="sticky top-[4.5rem] z-30 border-slate-200 bg-white/95 shadow-sm backdrop-blur">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">เพิ่มสินค้า (Smart SKU Picker)</CardTitle>
          <CardDescription>
            {vendorId
              ? "สินค้าของผู้จำหน่ายรายนี้อยู่กลุ่มแรก พร้อมรหัสผู้ขายและต้นทุนล่าสุด (LPP) — ค้นหาสินค้าทั้งคลังได้ตามปกติ"
              : "เลือกผู้จำหน่ายก่อนเพื่อดึงสินค้าที่ผูกไว้ แล้วค้นหาสินค้าในคลังได้ตามปกติ"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SmartSkuPicker
            ref={skuPickerRef}
            mode="purchases"
            disabled={isPending}
            vendorCatalog={vendorProducts}
            placeholder="ค้นหา SKU หรือชื่อสินค้าเพื่อรับเข้าคลัง..."
            onSelectProduct={handleSelectProduct}
          />
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0 pb-3">
          <div>
            <CardTitle className="text-base">รายการรับเข้า</CardTitle>
            <CardDescription>
              {lines.length} รายการ • จำนวนรับเข้า: {qtySummary.receivedQtyLabel} • ยอดสินค้า{" "}
              {formatMoney(totals.gross)}
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending || lines.length === 0}
            onClick={() => setLines([])}
          >
            ล้างรายการทั้งหมด
          </Button>
        </CardHeader>
        <CardContent className="px-3 sm:px-4">
          <div className="max-h-[58vh] overflow-y-auto">
          <Table
            wrapperClassName="overflow-x-visible overflow-y-visible"
            className="w-full table-fixed border-collapse"
          >
            <colgroup>
              <col className="w-[4%]" />
              <col className="w-[40%]" />
              <col className="w-[10%]" />
              <col className="w-[11%]" />
              <col className="w-[11%]" />
              <col className="w-[5%]" />
              <col className="w-[8%]" />
              <col className="w-[8%]" />
              <col className="w-[3%]" />
            </colgroup>
            <TableHeader className="sticky top-0 z-20 bg-slate-50 shadow-xs [&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-slate-50">
              <TableRow>
                <TableHead className="h-auto w-[4%] px-2 py-2.5 text-center normal-case tracking-normal">
                  #
                </TableHead>
                <TableHead className="h-auto w-[40%] px-2 py-2.5 text-left normal-case tracking-normal">
                  รายการสินค้า (ชื่อสินค้า / รหัส SKU)
                </TableHead>
                <TableHead className="h-auto w-[10%] px-2 py-2.5 text-right normal-case tracking-normal">
                  จำนวน
                </TableHead>
                <TableHead className="h-auto w-[11%] px-2 py-2.5 text-center normal-case tracking-normal">
                  หน่วยรับเข้า
                </TableHead>
                <TableHead className="h-auto w-[11%] px-2 py-2.5 text-right normal-case tracking-normal">
                  ต้นทุน/หน่วย
                </TableHead>
                <TableHead className="h-auto w-[5%] px-2 py-2.5 text-center normal-case tracking-normal">
                  ของแถม
                </TableHead>
                <TableHead className="h-auto w-[8%] px-2 py-2.5 text-right normal-case tracking-normal">
                  NET UNIT COST
                </TableHead>
                <TableHead className="h-auto w-[8%] px-2 py-2.5 text-right normal-case tracking-normal">
                  TOTAL AMOUNT
                </TableHead>
                <TableHead className="h-auto w-[3%] px-2 py-2.5 text-center normal-case tracking-normal">
                  ลบ
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="h-24 px-2 py-2.5 text-center text-slate-500">
                    ยังไม่มีรายการ — ใช้ช่องค้นหาด้านบนเพื่อเพิ่มสินค้า
                  </TableCell>
                </TableRow>
              ) : (
                lines.map((line, index) => {
                  const cost = costPreviewByKey.get(line.key);
                  const invoice = invoicePreviewByKey.get(line.key);
                  const invoiceTotal = Number(invoice?.finalLineTotal ?? 0);
                  const costBase =
                    calcMode === "LINE_2DEC"
                      ? Number(cost?.finalLineTotal ?? 0)
                      : vatType === "INCLUSIVE"
                        ? invoiceTotal / 1.07
                        : invoiceTotal;
                  const allocated = costBase + Number(freightByKey.get(line.key) ?? 0);
                  const baseUnitCost = netUnitCostPerBase(
                    allocated,
                    line.qty,
                    resolveConversionFactor(line.conversionFactor),
                  );
                  return (
                    <TableRow
                      key={line.key}
                      ref={line.key === focusLineKey ? lastRowRef : undefined}
                    >
                      <TableCell className="px-2 py-2.5 text-center">
                        <span className="inline-flex rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-700">
                          {index + 1}
                        </span>
                      </TableCell>
                      <TableCell className="min-w-0 px-2 py-2.5 text-left">
                        <p className="whitespace-normal break-words text-sm font-semibold leading-snug text-slate-900">
                          {line.name}
                          <span className="ml-1.5 inline-block rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] font-normal text-slate-600">
                            {line.sku}
                          </span>
                          {normalizePurchaseTaxMode(line.taxType) ? (
                            <span
                              className={cn(
                                "ml-1.5 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold",
                                minorityModes.has(normalizePurchaseTaxMode(line.taxType)!)
                                  ? "animate-pulse bg-red-100 text-red-800 ring-2 ring-red-500"
                                  : "bg-violet-100 text-violet-700",
                              )}
                            >
                              {normalizePurchaseTaxMode(line.taxType)}
                            </span>
                          ) : null}
                        </p>
                        {line.vendorSku ? (
                          <p className="mt-0.5 whitespace-normal break-words text-xs text-slate-500">
                            {line.vendorSku}
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="px-2 py-2.5 text-right">
                        <Input
                          ref={line.key === focusLineKey ? qtyInputRef : undefined}
                          type="number"
                          min={0}
                          step="0.0001"
                          value={line.qty}
                          disabled={isPending}
                          className="h-8 w-full px-2 text-right text-sm font-medium"
                          onChange={(e) =>
                            updateLine(line.key, {
                              qty: Math.max(0, Number(e.target.value) || 0),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="min-w-0 px-2 py-2.5 text-center">
                        <PurchaseUomCell
                          compact
                          catalog={purchaseUoms}
                          uomCode={line.purchaseUomCode}
                          conversionFactor={line.conversionFactor}
                          qty={line.qty}
                          baseUnitLabel={
                            line.baseUom ||
                            purchaseUoms.find((item) => item.uom_code === line.purchaseUomCode)
                              ?.uom_name ||
                            ""
                          }
                          disabled={isPending}
                          onChange={({ uomCode, conversionFactor }) =>
                            updateLine(line.key, {
                              purchaseUomCode: uomCode,
                              conversionFactor,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="px-2 py-2.5 text-right">
                        <Input
                          type="number"
                          min={0}
                          step="0.0001"
                          value={line.isFoc ? 0 : line.unit_cost}
                          disabled={isPending || line.isFoc}
                          className="h-8 w-full px-2 text-right text-sm font-medium"
                          onChange={(e) => {
                            const raw = e.target.value;
                            if (raw.trim() === "") return;
                            const next = Number(raw);
                            if (!Number.isFinite(next) || next < 0) return;
                            updateLine(line.key, { unit_cost: Math.round(next * 10000) / 10000 });
                          }}
                        />
                      </TableCell>
                      <TableCell className="px-2 py-2.5 text-center">
                        <input
                          type="checkbox"
                          checked={line.isFoc}
                          disabled={isPending}
                          className="mx-auto block"
                          aria-label={`ของแถม ${line.sku}`}
                          onChange={(event) =>
                            updateLine(line.key, { isFoc: event.target.checked })
                          }
                        />
                      </TableCell>
                      <TableCell
                        className="px-2 py-2.5 text-right text-sm font-semibold tabular-nums text-emerald-600"
                        title={
                          vatType === "INCLUSIVE"
                            ? "ทุนสุทธิต่อหน่วยฐานหลังถอด VAT 7% ตาม TAS 2"
                            : "ทุนสุทธิต่อหน่วยฐาน"
                        }
                      >
                        {formatMoney(line.isFoc ? 0 : baseUnitCost)}
                      </TableCell>
                      <TableCell className="px-2 py-2.5 text-right text-sm font-bold tabular-nums text-slate-900">
                        {formatMoney(line.isFoc ? 0 : Number(invoice?.finalLineTotal ?? 0))}
                      </TableCell>
                      <TableCell className="px-2 py-2.5 text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          disabled={isPending}
                          onClick={() => removeLine(line.key)}
                          aria-label="ลบรายการ"
                        >
                          <Trash2 className="h-4 w-4 text-red-500" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
          <button
            type="button"
            disabled={isPending}
            onClick={() => skuPickerRef.current?.openAndFocus()}
            className="mt-2 w-full rounded-lg border border-dashed border-slate-300 py-2 text-sm font-medium text-slate-600 hover:border-blue-500 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
          >
            + เพิ่มรายการสินค้า (คลิกที่นี่ หรือกด Alt+A เพื่อค้นหา SKU)
          </button>
          </div>
        </CardContent>
      </Card>

      {lines.length > 0 ? (
        <DualFreightFields
          carriers={carriers}
          onCarriersChange={setCarriers}
          freightCost={freightCostInput}
          onFreightCostChange={setFreightCostInput}
          freightTaxMode={freightTaxMode}
          onFreightTaxModeChange={setFreightTaxMode}
          destFreightCost={destFreightInput}
          onDestFreightCostChange={setDestFreightInput}
          carrierId={carrierId}
          onCarrierIdChange={setCarrierId}
          trackingNo={carrierTrackingNo}
          onTrackingNoChange={setCarrierTrackingNo}
          disabled={isPending}
        />
      ) : null}

      {lines.length > 0 ? (
        <Card className="border-violet-200 bg-violet-50/40">
          <CardContent className="p-4">
            <MixedTaxConflictBanner
              consensus={taxConsensus}
              confirmed={mixedTaxConfirmed}
              onConfirmedChange={setMixedTaxConfirmed}
            />
            <div className="max-w-md">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-violet-500">
                ตรวจสอบโหมดภาษี (VAT Mode)
              </p>
              <Label htmlFor="manual-receipt-tax-mode" className="mt-2 text-sm font-semibold text-slate-900">
                โหมดภาษี
              </Label>
              <select
                id="manual-receipt-tax-mode"
                value={vatTypeToPurchaseTaxMode(vatType)}
                onChange={(event) => {
                  setTaxModeLocked(true);
                  setVatType(purchaseTaxModeToVatType(event.target.value as PurchaseTaxMode));
                }}
                disabled={isPending}
                className={cn(selectClassName, "mt-1")}
              >
                <option value="EXC_VAT">EXC_VAT — ภาษีนอก (+7% เพิ่มจากยอดบิล)</option>
                <option value="INC_VAT">INC_VAT — ราคารวมภาษี (ถอด VAT 7% ในตัว)</option>
                <option value="NON_VAT">NONE — ไม่มีภาษี (0%)</option>
              </select>
              <p
                className={cn(
                  "mt-2 text-[11px] leading-relaxed",
                  taxConsensus.hasUnanimousConsensus &&
                    taxConsensus.consensusTaxType &&
                    vatTypeToPurchaseTaxMode(vatType) === taxConsensus.consensusTaxType
                    ? "text-emerald-700"
                    : "text-violet-700",
                )}
              >
                {taxConsensus.hasUnanimousConsensus &&
                taxConsensus.consensusTaxType &&
                vatTypeToPurchaseTaxMode(vatType) === taxConsensus.consensusTaxType
                  ? `✓ ตั้งค่าอัตโนมัติตามประเภทภาษีของสินค้าในบิล (${purchaseTaxModeLabel(taxConsensus.consensusTaxType)} ครบทุกบรรทัด)`
                  : defaultHint || "เลือกผู้จำหน่ายเพื่อดึงโหมดภาษีจากเอกสารล่าสุดหรือสินค้าที่ผูกไว้"}
                {" • เอกสาร: "}
                {docType}
              </p>
              {taxConsensus.hasUnanimousConsensus && taxConsensus.consensusTaxType ? (
                <TaxModeMismatchBanner
                  documentMode={vatTypeToPurchaseTaxMode(vatType)}
                  consensusTaxType={taxConsensus.consensusTaxType}
                  onApplyConsensus={applyProductTaxConsensus}
                />
              ) : null}
              {showCalcModes ? (
                <VendorCalcModeBar
                  mode={calcMode}
                  quotes={calcQuotes}
                  disabled={isPending}
                  onChange={handleCalcModeChange}
                />
              ) : null}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-dashed border-violet-200 pt-4 lg:grid-cols-2">
              <InventoryLandedCostCard
                finished={qtySummary.finished}
                raw={qtySummary.raw}
                originFreight={originFreightInventory}
                destFreight={destFreightNormalized}
                destCarrierName={destCarrierName}
                pool={landedCostPool}
                poolAverage={qtySummary.poolAverage}
                formatMoney={formatMoney}
              />

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-800">
                  สรุปยอดตั้งหนี้ผู้ขายและใบวางบิล — AP Invoice & Settlement
                </p>
                <SummaryRow label="รวมรายการสินค้า" amount={formatMoney(totals.gross)} />
                <SummaryRow label="หักส่วนลดท้ายบิล" amount={formatMoney(billDiscount)} />
                <SummaryRow label={originFreightApLabel} amount={formatMoney(freightCostNormalized)} />
                <label className="mt-2 flex items-center justify-between gap-3 text-sm text-slate-600">
                  <span>ยอดก่อน VAT (ฐานภาษี)</span>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={documentSummary.preVatAmount.toFixed(2)}
                    key={`pre-${documentSummary.preVatAmount}`}
                    className="h-8 w-28 rounded-lg border border-slate-200 px-2 text-right text-sm"
                    onBlur={(event) => {
                      const typed = roundMoney2(Number(event.target.value));
                      const freightInBase =
                        freightTaxMode === "SEPARATE_NON_VAT" ? 0 : freightCostNormalized;
                      const goodsNow = roundMoney2(
                        lines.reduce(
                          (sum, line) =>
                            sum + Number(invoicePreviewByKey.get(line.key)?.finalLineTotal ?? 0),
                          0,
                        ),
                      );
                      const targetGoods =
                        vatType === "INCLUSIVE"
                          ? roundMoney2(roundMoney2(typed * 1.07) - freightInBase)
                          : roundMoney2(typed - freightInBase);
                      const delta = roundMoney2(targetGoods - (goodsNow - pennyDelta));
                      const nextGrand =
                        vatType === "EXCLUSIVE"
                          ? roundMoney2(typed + roundMoney2(typed * 0.07))
                          : vatType === "INCLUSIVE"
                            ? roundMoney2(typed * 1.07)
                            : typed;
                      balanceManualPenny(delta, roundMoney2(nextGrand - documentSummary.grandTotal));
                    }}
                  />
                </label>
                <label className="mt-2 flex items-center justify-between gap-3 text-sm text-slate-600">
                  <span>VAT Amount (7%)</span>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={documentSummary.vatAmount.toFixed(2)}
                    key={`vat-${documentSummary.vatAmount}`}
                    className="h-8 w-28 rounded-lg border border-slate-200 px-2 text-right text-sm"
                    onBlur={(event) => {
                      const typed = roundMoney2(Number(event.target.value));
                      setRoundingGap(roundMoney2(typed - documentSummary.vatAmount + roundingGap));
                    }}
                  />
                </label>
                <label className="mt-2 flex items-center justify-between gap-3 text-sm font-semibold text-slate-800">
                  <span>Grand Total (เจ้าหนี้ผู้ขาย)</span>
                  <input
                    type="number"
                    step="0.01"
                    defaultValue={documentSummary.grandTotal.toFixed(2)}
                    key={`grand-${documentSummary.grandTotal}`}
                    className="h-8 w-28 rounded-lg border border-slate-200 px-2 text-right text-sm font-semibold"
                    onBlur={(event) => {
                      const typed = roundMoney2(Number(event.target.value));
                      const gap = roundMoney2(typed - documentSummary.grandTotal);
                      const delta = vatType === "EXCLUSIVE" ? roundMoney2(gap / 1.07) : gap;
                      balanceManualPenny(roundMoney2(pennyDelta + delta), roundMoney2(roundingGap + gap));
                    }}
                  />
                </label>
                <p className="text-right text-[11px] text-slate-500">
                  ({numberToThaiBaht(documentSummary.grandTotal)})
                </p>
                {destFreightNormalized > 0 ? (
                  <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                    ค่าขนส่งปลายทาง (จ่ายแยกให้บริษัทขนส่ง ไม่รวมในหนี้ผู้ขาย): ฿
                    {formatMoney(destFreightNormalized)}
                  </p>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {lines.length > 0 ? (
        <div className="sticky bottom-4 z-30 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white/95 px-5 py-4 shadow-lg backdrop-blur sm:flex-row sm:items-end sm:justify-between">
          <div className="flex flex-wrap items-end gap-4">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Total Received Qty
              </p>
              <p className="text-lg font-bold text-slate-900">
                {qtySummary.receivedQtyCompact}
              </p>
            </div>
            <div className="w-44">
              <Label
                htmlFor="manual-receipt-discount"
                className="text-[10px] font-semibold uppercase tracking-wide text-slate-400"
              >
                ส่วนลดท้ายบิล (%, บาท)
              </Label>
              <Input
                id="manual-receipt-discount"
                value={discountText}
                onChange={(event) => setDiscountText(event.target.value)}
                placeholder="เช่น 40%, 1500"
                disabled={isPending}
                className="mt-1 h-9 text-sm"
              />
            </div>
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                Grand Total
              </p>
              <p className="text-lg font-bold text-emerald-700">
                ฿{formatMoney(documentSummary.grandTotal)}
              </p>
            </div>
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
              disabled={!canSave}
              onClick={handleReview}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <PackagePlus className="size-4" />
              {isPending ? "กำลังบันทึก..." : "ตรวจสอบและบันทึกรับสินค้า"}
            </Button>
          </div>
        </div>
      ) : null}

      <CarrierFreightSummaryDialog
        open={freightSummaryOpen}
        onOpenChange={setFreightSummaryOpen}
        carriers={carriers}
      />
      <ManualReceiptPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        onConfirm={postReceipt}
        isPending={isPending}
        company={company}
        vendorName={selectedVendor?.company_name ?? "—"}
        vendorAddress={selectedVendor?.address}
        vendorTaxId={selectedVendor?.tax_id}
        vendorPhone={selectedVendor?.phone}
        vendorBranchCode={selectedVendor?.branch_code}
        docDate={docDate}
        documentRef={documentRef.trim()}
        docType={docType}
        docTypeLabel={DOC_TYPE_OPTIONS.find((option) => option.value === docType)?.label ?? docType}
        vatLabel={vatTypeToPurchaseTaxMode(vatType) === "NON_VAT" ? "NONE" : vatTypeToPurchaseTaxMode(vatType)}
        lines={lines.map((line) => ({
          key: line.key,
          sku: line.vendorSku || line.sku,
          name: line.name,
          qty: line.qty,
          uom: line.purchaseUomCode,
          unitCost: line.unit_cost,
          isFoc: line.isFoc,
          lineTotal: line.isFoc ? 0 : Number(invoicePreviewByKey.get(line.key)?.finalLineTotal ?? 0),
          freight: Number(freightByKey.get(line.key) ?? 0),
        }))}
        goodsGross={totals.gross}
        billDiscount={billDiscount}
        originFreight={freightCostNormalized}
        destFreight={destFreightNormalized}
        taxBase={documentSummary.preVatAmount}
        vatAmount={documentSummary.vatAmount}
        grandTotal={documentSummary.grandTotal}
        landedPool={landedCostPool}
      />
    </div>
  );
}

function SummaryRow({
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
