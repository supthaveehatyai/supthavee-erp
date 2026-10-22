"use client";

/**
 * Manual Goods Receipt workspace — Client island.
 * Persistence via `saveManualGoodsReceipt` Server Action only (no client Supabase).
 */

import { useMemo, useState, useTransition } from "react";
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
import { saveManualGoodsReceipt } from "@/lib/actions/receipt";
import { uploadProcurementBills } from "@/lib/procurement/upload-bill-files";
import { BillAttachmentPicker } from "@/components/procurement/bill-attachment-picker";
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
  type PurchaseTaxMode,
} from "@/lib/utils/purchase-tax";
import { calculateLandedCost, resolveFreightExVat } from "@/lib/utils/landed-cost";
import {
  computeVendorPayable,
  type FreightTaxMode,
} from "@/lib/utils/dual-freight";
import type { CarrierOption } from "@/types/carrier";
import type { PrintCompanyProfile } from "@/types/print-document";
import { DualFreightFields } from "@/components/procurement/DualFreightFields";
import { CarrierFreightSummaryDialog } from "@/components/procurement/CarrierFreightSummaryDialog";
import type { SalesProductSearchItem } from "@/types/document";
import type { VendorMappedReceiptProduct } from "@/types/manual-receipt";
import { ManualReceiptPreviewDialog } from "@/app/(erp)/purchases/manual-receipt/manual-receipt-preview-dialog";
import SmartSkuPicker from "@/components/sales/smart-sku-picker";
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
import { PurchaseUomCell } from "@/components/procurement/PurchaseUomCell";
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
};

export type ManualReceiptWorkspaceProps = {
  vendors: VendorOption[];
  vendorsError: string | null;
  purchaseUoms: PurchaseUomOption[];
  initialCarriers: CarrierOption[];
  company: PrintCompanyProfile;
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
}: ManualReceiptWorkspaceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [, startDefaults] = useTransition();
  const [billFiles, setBillFiles] = useState<File[]>([]);
  const [vendorProducts, setVendorProducts] = useState<VendorMappedReceiptProduct[]>([]);
  const [defaultHint, setDefaultHint] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);

  const [vendorId, setVendorId] = useState("");
  const [docDate, setDocDate] = useState(todayIsoDate);
  const [documentRef, setDocumentRef] = useState("");
  const [docType, setDocType] = useState<GoodsReceiptDocType>("AP_TAX");
  const [vatType, setVatType] = useState<VatCalculationType>("NONE");
  const [discountText, setDiscountText] = useState("");
  const [freightCostInput, setFreightCostInput] = useState("");
  const [freightTaxMode, setFreightTaxMode] = useState<FreightTaxMode>("INCLUDED_IN_TAX");
  const [destFreightInput, setDestFreightInput] = useState("");
  const [carrierId, setCarrierId] = useState("");
  const [carrierTrackingNo, setCarrierTrackingNo] = useState("");
  const [carriers, setCarriers] = useState(initialCarriers);
  const [freightSummaryOpen, setFreightSummaryOpen] = useState(false);
  const [lines, setLines] = useState<ManualReceiptLine[]>([]);

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

  const invoicePreviewByKey = useMemo(() => {
    const items: ApportionmentItem[] = lines.map((line) => ({
      id: line.key,
      unitPrice: Number(line.unit_cost) || 0,
      qty: Number(line.qty) || 0,
      isFoc: line.isFoc,
    }));
    return new Map(
      calculateNetCostApportionment(items, discountText || null, {
        vatType: "NONE",
        vatRate: 0,
      }).map((row) => [row.id, row]),
    );
  }, [lines, discountText]);

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
  const landedUnitAverage = totals.qty > 0 ? landedCostPool / totals.qty : 0;
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
    });
  }

  function handleSelectProduct(product: SalesProductSearchItem) {
    if (product.is_service) {
      toast.error(
        "ไม่สามารถรับงานบริการ (Service) เข้าคลัง — เลือกวัตถุดิบหรือสินค้าสำเร็จรูป",
      );
      return;
    }

    setLines((current) => {
      const existing = current.find((row) => row.product_id === product.id);
      if (existing) {
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
      return [
        ...current,
        {
          key: `${product.id}-${Date.now()}`,
          product_id: product.id,
          sku: product.sku,
          name: product.display_name,
          qty: 1,
          unit_cost: roundMoney(Number(product.cost_price) || 0),
          purchaseUomCode: purchaseUom.uomCode,
          conversionFactor: purchaseUom.conversionFactor,
          isFoc: false,
          vendorSku: mapped.vendor_sku ?? "",
        },
      ];
    });
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

  function postReceipt() {
    startTransition(async () => {
      let bills = null;
      if (billFiles.length > 0) {
        const uploaded = await uploadProcurementBills(billFiles, documentRef.trim());
        if (uploaded.error || !uploaded.data) {
          toast.error(uploaded.error ?? "อัปโหลดรูปบิลไม่สำเร็จ");
          return;
        }
        bills = uploaded.data;
      }
      const result = await saveManualGoodsReceipt({
        vendorId,
        docDate,
        documentRef: documentRef.trim(),
        bills,
        docType,
        vatType,
        discountText: discountText.trim() || null,
        freightCost: freightCostNormalized,
        freightTaxMode,
        destFreightCost: destFreightNormalized,
        carrierId: carrierId || null,
        carrierTrackingNo: carrierTrackingNo || null,
        status: "ISSUED",
        lines: lines.map((line) => ({
          product_id: line.product_id,
          qty: line.qty,
          unit_cost: line.unit_cost,
          description: line.name,
          sku: line.sku,
          purchaseUomCode: line.purchaseUomCode,
          conversionFactor: line.conversionFactor,
          isFoc: line.isFoc,
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
      setPreviewOpen(false);
      router.push(
        `/purchases/${encodeURIComponent(result.data.doc_no)}?view=form&paper=A5-Portrait`,
      );
    });
  }

  function handleReview() {
    if (!validateForm()) return;
    setPreviewOpen(true);
  }

  const canSave =
    Boolean(vendorId) &&
    Boolean(documentRef.trim()) &&
    lines.length > 0 &&
    !isPending;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
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
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">รูปบิล / เอกสารอ้างอิง</CardTitle>
          </CardHeader>
          <CardContent>
            <BillAttachmentPicker
              compact
              files={billFiles}
              onChange={setBillFiles}
              disabled={isPending}
            />
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
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
              {lines.length} รายการ · จำนวนฐาน {totals.qty.toLocaleString("th-TH")} ·
              ยอดสินค้า {formatMoney(totals.gross)}
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
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">รหัสสินค้า</TableHead>
                  <TableHead>ชื่อสินค้า</TableHead>
                  <TableHead className="w-[110px] text-right">จำนวน</TableHead>
                  <TableHead className="min-w-[180px]">หน่วยรับเข้า (UOM)</TableHead>
                  <TableHead className="w-[140px] text-right">ต้นทุน/หน่วย</TableHead>
                  <TableHead className="w-[88px] text-center">ของแถม</TableHead>
                  <TableHead className="w-[130px] text-right">Net Unit Cost</TableHead>
                  <TableHead className="w-[120px] text-right">Total Amount</TableHead>
                  <TableHead className="w-[56px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={9} className="h-24 text-center text-slate-500">
                      ยังไม่มีรายการ — ใช้ช่องค้นหาด้านบนเพื่อเพิ่มสินค้า
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((line) => {
                    const cost = costPreviewByKey.get(line.key);
                    const invoice = invoicePreviewByKey.get(line.key);
                    const allocated =
                      Number(cost?.finalLineTotal ?? 0) +
                      Number(freightByKey.get(line.key) ?? 0);
                    const baseUnitCost = netUnitCostPerBase(
                      allocated,
                      line.qty,
                      resolveConversionFactor(line.conversionFactor),
                    );
                    const baseQty = stockBaseQty(line.qty, line.conversionFactor);
                    return (
                      <TableRow key={line.key}>
                        <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-900">
                          {line.vendorSku || line.sku}
                          {line.vendorSku ? (
                            <p className="font-sans text-[10px] font-normal text-slate-400">
                              {line.sku}
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate text-slate-700">
                          {line.name}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.0001"
                            value={line.qty}
                            disabled={isPending}
                            className="ml-auto h-9 w-[96px] text-right tabular-nums"
                            onChange={(e) =>
                              updateLine(line.key, {
                                qty: Math.max(0, Number(e.target.value) || 0),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <PurchaseUomCell
                            catalog={purchaseUoms}
                            uomCode={line.purchaseUomCode}
                            conversionFactor={line.conversionFactor}
                            qty={line.qty}
                            disabled={isPending}
                            onChange={({ uomCode, conversionFactor }) =>
                              updateLine(line.key, {
                                purchaseUomCode: uomCode,
                                conversionFactor,
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.isFoc ? 0 : line.unit_cost}
                            disabled={isPending || line.isFoc}
                            className="ml-auto h-9 w-[128px] text-right tabular-nums"
                            onChange={(e) =>
                              updateLine(line.key, {
                                unit_cost: roundMoney(Number(e.target.value) || 0),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-center">
                          <input
                            type="checkbox"
                            checked={line.isFoc}
                            disabled={isPending}
                            aria-label={`ของแถม ${line.sku}`}
                            onChange={(event) =>
                              updateLine(line.key, { isFoc: event.target.checked })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-emerald-700">
                          <div>{formatMoney(line.isFoc ? 0 : baseUnitCost)}</div>
                          {resolveConversionFactor(line.conversionFactor) > 1 ? (
                            <p className="text-[10px] font-normal text-blue-700">
                              = {baseQty.toLocaleString("th-TH")} ตัว
                            </p>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-slate-900">
                          {formatMoney(line.isFoc ? 0 : Number(invoice?.finalLineTotal ?? 0))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isPending}
                            onClick={() => removeLine(line.key)}
                            aria-label="ลบรายการ"
                          >
                            <Trash2 className="size-4 text-slate-400" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
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
                onChange={(event) =>
                  setVatType(purchaseTaxModeToVatType(event.target.value as PurchaseTaxMode))
                }
                disabled={isPending}
                className={cn(selectClassName, "mt-1")}
              >
                <option value="EXC_VAT">EXC_VAT — ภาษีนอก (+7% เพิ่มจากยอดบิล)</option>
                <option value="INC_VAT">INC_VAT — ราคารวมภาษี (ถอด VAT 7% ในตัว)</option>
                <option value="NON_VAT">NONE — ไม่มีภาษี (0%)</option>
              </select>
              <p className="mt-2 text-[11px] leading-relaxed text-violet-700">
                {defaultHint || "เลือกผู้จำหน่ายเพื่อดึงโหมดภาษีจากเอกสารล่าสุดหรือสินค้าที่ผูกไว้"}
                {" • เอกสาร: "}
                {docType}
              </p>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 border-t border-dashed border-violet-200 pt-4 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-800">
                  สรุปต้นทุนรับเข้าคลังตามมาตรฐาน TAS 2 — Inventory Landed Cost
                </p>
                <SummaryRow
                  label={`มูลค่าสินค้าสุทธิ (ก่อน VAT) • ${totals.qty.toLocaleString("th-TH")} ตัว`}
                  amount={`฿${formatMoney(goodsExVatTotal)}`}
                />
                <SummaryRow
                  label="+ ค่าขนส่งต้นทาง (เข้าต้นทุนสินค้า)"
                  amount={`฿${formatMoney(originFreightInventory)}`}
                />
                <SummaryRow
                  label={`+ ค่าขนส่งเก็บปลายทาง (${destCarrierName})`}
                  amount={`฿${formatMoney(destFreightNormalized)}`}
                />
                <SummaryRow
                  label="รวมฐานต้นทุนเข้าคลังสุทธิ (Landed Cost Pool)"
                  amount={`฿${formatMoney(landedCostPool)}`}
                  strong
                />
                <p className="text-right text-[11px] text-slate-500">
                  เฉลี่ย ฿{formatMoney(landedUnitAverage)} / ตัว
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <p className="text-xs font-semibold text-slate-800">
                  สรุปยอดตั้งหนี้ผู้ขายและใบวางบิล — AP Invoice & Settlement
                </p>
                <SummaryRow label="รวมรายการสินค้า" amount={formatMoney(totals.gross)} />
                <SummaryRow label="หักส่วนลดท้ายบิล" amount={formatMoney(billDiscount)} />
                <SummaryRow label={originFreightApLabel} amount={formatMoney(freightCostNormalized)} />
                <SummaryRow label="ฐานภาษี" amount={formatMoney(documentSummary.preVatAmount)} />
                <SummaryRow label="VAT 7%" amount={formatMoney(documentSummary.vatAmount)} />
                <SummaryRow
                  label="ยอดสุทธิตั้งหนี้ผู้ขาย"
                  amount={formatMoney(documentSummary.grandTotal)}
                  strong
                />
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
                {totals.qty.toLocaleString("th-TH")}{" "}
                <span className="text-xs font-medium text-slate-400">ตัว</span>
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
