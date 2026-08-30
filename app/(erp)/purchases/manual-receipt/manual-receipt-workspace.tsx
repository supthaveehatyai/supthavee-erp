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
import { saveManualGoodsReceipt } from "@/lib/actions/receipt";
import type { GoodsReceiptDocType } from "@/lib/constants/document";
import {
  calculateNetCostApportionment,
  type ApportionmentItem,
} from "@/lib/utils/accounting";
import { VAT_OPTIONS } from "@/lib/constants/accounting";
import {
  calculateDocumentSummary,
  type VatCalculationType,
} from "@/lib/utils/document-summary";
import { DocumentPrintSummary } from "@/components/shared/print/DocumentPrintSummary";
import type { PrintVatType } from "@/types/print-document";
import type { SalesProductSearchItem } from "@/types/document";
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

export type ManualReceiptLine = {
  key: string;
  product_id: string;
  sku: string;
  name: string;
  qty: number;
  unit_cost: number;
};

export type ManualReceiptWorkspaceProps = {
  vendors: VendorOption[];
  vendorsError: string | null;
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
}: ManualReceiptWorkspaceProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [vendorId, setVendorId] = useState("");
  const [docDate, setDocDate] = useState(todayIsoDate);
  const [documentRef, setDocumentRef] = useState("");
  const [docType, setDocType] = useState<GoodsReceiptDocType>("AP_TAX");
  const [vatType, setVatType] = useState<VatCalculationType>("NONE");
  const [discountText, setDiscountText] = useState("");
  const [freightCostInput, setFreightCostInput] = useState("");
  const [lines, setLines] = useState<ManualReceiptLine[]>([]);

  const costPreviewByKey = useMemo(() => {
    const items: ApportionmentItem[] = lines.map((line) => ({
      id: line.key,
      unitPrice: Number(line.unit_cost) || 0,
      qty: Number(line.qty) || 0,
      isFoc: false,
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
      isFoc: false,
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
      qty += Number(line.qty) || 0;
      gross += (Number(line.qty) || 0) * (Number(line.unit_cost) || 0);
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

  const documentSummary = useMemo(() => {
    const lineTotals = lines.map(
      (line) => invoicePreviewByKey.get(line.key)?.finalLineTotal ?? 0,
    );
    return calculateDocumentSummary({
      lineTotals,
      freightCost: freightCostNormalized,
      discountText: null,
      vatType,
      vatRate: vatType === "NONE" ? 0 : 7,
    });
  }, [lines, invoicePreviewByKey, freightCostNormalized, vatType]);

  function handleSelectProduct(product: SalesProductSearchItem) {
    setLines((current) => {
      const existing = current.find((row) => row.product_id === product.id);
      if (existing) {
        return current.map((row) =>
          row.product_id === product.id
            ? { ...row, qty: row.qty + 1 }
            : row,
        );
      }
      return [
        ...current,
        {
          key: `${product.id}-${Date.now()}`,
          product_id: product.id,
          sku: product.sku,
          name: product.display_name,
          qty: 1,
          unit_cost: roundMoney(Number(product.cost_price) || 0),
        },
      ];
    });
    toast.success(`เพิ่ม ${product.sku} ลงรายการแล้ว`);
  }

  function updateLine(
    key: string,
    patch: Partial<Pick<ManualReceiptLine, "qty" | "unit_cost">>,
  ) {
    setLines((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  }

  function removeLine(key: string) {
    setLines((current) => current.filter((row) => row.key !== key));
  }

  function handleSave() {
    if (!vendorId) {
      toast.error("กรุณาเลือกผู้จำหน่าย (Vendor)");
      return;
    }
    if (!documentRef.trim()) {
      toast.error("กรุณากรอกเลขที่เอกสารอ้างอิง (Vendor Ref No.)");
      return;
    }
    if (lines.length === 0) {
      toast.error("กรุณาเพิ่มสินค้าอย่างน้อย 1 รายการ");
      return;
    }

    for (const [index, line] of lines.entries()) {
      if (!Number.isFinite(line.qty) || line.qty <= 0) {
        toast.error(`รายการที่ ${index + 1}: จำนวนต้องมากกว่า 0`);
        return;
      }
      if (!Number.isFinite(line.unit_cost) || line.unit_cost < 0) {
        toast.error(`รายการที่ ${index + 1}: ต้นทุนต่อหน่วยไม่ถูกต้อง`);
        return;
      }
    }

    startTransition(async () => {
      const result = await saveManualGoodsReceipt({
        vendorId,
        docDate,
        documentRef: documentRef.trim(),
        docType,
        vatType,
        discountText: discountText.trim() || null,
        freightCost: freightCostNormalized,
        lines: lines.map((line) => ({
          product_id: line.product_id,
          qty: line.qty,
          unit_cost: line.unit_cost,
          description: line.name,
          sku: line.sku,
        })),
      });

      if (result.error || !result.data) {
        toast.error(result.error ?? "บันทึกรับสินค้าไม่สำเร็จ");
        return;
      }

      toast.success(
        `รับสินค้าเข้าคลังสำเร็จ — ${result.data.doc_no}` +
          ` · ตัดเข้า ${result.data.ledger_count} รายการ · อัปเดต LPP (Net Cost) แล้ว`,
      );
      router.push(`/purchases/${encodeURIComponent(result.data.doc_no)}`);
    });
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

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">หัวเอกสาร</CardTitle>
          <CardDescription>
            Vendor · วันที่ · เลขอ้างอิง (บังคับ) · ประเภทเอกสาร / VAT · ส่วนลดท้ายบิล
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          <div className="space-y-1.5 lg:col-span-1">
            <Label>ผู้จำหน่าย (Vendor)</Label>
            <VendorCombobox
              options={vendors}
              value={vendorId}
              onChange={setVendorId}
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
          <div className="space-y-1.5">
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
          <div className="space-y-1.5">
            <Label htmlFor="manual-receipt-vat-type">ประเภทภาษี (VAT)</Label>
            <select
              id="manual-receipt-vat-type"
              value={vatType}
              onChange={(e) => setVatType(e.target.value as VatCalculationType)}
              disabled={isPending}
              className={selectClassName}
            >
              {VAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-receipt-discount">ส่วนลดท้ายบิล (%, บาท)</Label>
            <Input
              id="manual-receipt-discount"
              value={discountText}
              onChange={(e) => setDiscountText(e.target.value)}
              placeholder="เช่น 40%, 1500"
              disabled={isPending}
              autoComplete="off"
            />
            <p className="text-[11px] text-slate-400">
              {vatType === "INCLUSIVE"
                ? "โหมดรวมภาษี: ระบบจะถอด VAT 7% ออกก่อนคำนวณ Net Cost / LPP"
                : "ระบบจะกระจายส่วนลดตามสัดส่วนมูลค่าก่อนอัปเดตต้นทุนสุทธิ"}
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="manual-receipt-freight">
              ค่าขนส่งต้นทาง (Freight Cost)
            </Label>
            <Input
              id="manual-receipt-freight"
              type="number"
              min={0}
              step="0.01"
              value={freightCostInput}
              onChange={(e) => setFreightCostInput(e.target.value)}
              placeholder="0.00"
              disabled={isPending}
              className="text-right tabular-nums"
            />
            <p className="text-[11px] text-slate-400">
              รวมใน Sub Total ก่อนคำนวณ VAT · บันทึกลง documents.freight_cost
            </p>
          </div>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">เพิ่มสินค้า</CardTitle>
          <CardDescription>
            Smart SKU Picker · ค้นหาผ่าน Server Action `searchProductsForSales`
            (debounce 300ms)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SmartSkuPicker
            disabled={isPending}
            placeholder="ค้นหา SKU หรือชื่อสินค้าเพื่อรับเข้าคลัง..."
            onSelectProduct={handleSelectProduct}
          />
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">รายการรับเข้า</CardTitle>
          <CardDescription>
            {lines.length} รายการ · จำนวนรวม {totals.qty.toLocaleString("th-TH")} ·
            ยอดตั้ง {formatMoney(totals.gross)} · Net Cost (LPP){" "}
            {formatMoney(totals.netCost)}
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">รหัสสินค้า</TableHead>
                  <TableHead>ชื่อสินค้า</TableHead>
                  <TableHead className="w-[110px] text-right">จำนวน</TableHead>
                  <TableHead className="w-[140px] text-right">
                    ต้นทุน/หน่วย
                  </TableHead>
                  <TableHead className="w-[130px] text-right">
                    Net Unit Cost
                  </TableHead>
                  <TableHead className="w-[120px] text-right">Total Amount</TableHead>
                  <TableHead className="w-[56px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-24 text-center text-slate-500"
                    >
                      ยังไม่มีรายการ — ใช้ช่องค้นหาด้านบนเพื่อเพิ่มสินค้า
                    </TableCell>
                  </TableRow>
                ) : (
                  lines.map((line) => {
                    const cost = costPreviewByKey.get(line.key);
                    const invoice = invoicePreviewByKey.get(line.key);
                    return (
                      <TableRow key={line.key}>
                        <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-900">
                          {line.sku}
                        </TableCell>
                        <TableCell className="max-w-[240px] truncate text-slate-700">
                          {line.name}
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={1}
                            step={1}
                            value={line.qty}
                            disabled={isPending}
                            className="ml-auto h-9 w-[96px] text-right tabular-nums"
                            onChange={(e) =>
                              updateLine(line.key, {
                                qty: Math.max(
                                  0,
                                  Math.round(Number(e.target.value) || 0),
                                ),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={line.unit_cost}
                            disabled={isPending}
                            className="ml-auto h-9 w-[128px] text-right tabular-nums"
                            onChange={(e) =>
                              updateLine(line.key, {
                                unit_cost: roundMoney(Number(e.target.value) || 0),
                              })
                            }
                          />
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-emerald-700">
                          {formatMoney(Number(cost?.finalUnitCost ?? 0))}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-slate-900">
                          {formatMoney(Number(invoice?.finalLineTotal ?? 0))}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isPending}
                            onClick={() => removeLine(line.key)}
                            aria-label={`ลบ ${line.sku}`}
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

      <div className="flex flex-col gap-4 rounded-2xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
            Net Cost รวม (ใช้ อัปเดต LPP)
          </p>
          <p className="text-2xl font-bold tabular-nums text-emerald-700">
            {formatMoney(totals.netCost)}
          </p>
          <p className="text-xs text-slate-500">
            ยอดตั้งก่อนถอด VAT/ส่วนลด: {formatMoney(totals.gross)} · {docType} /{" "}
            {vatType}
          </p>
        </div>
        <DocumentPrintSummary
          className="w-full max-w-sm"
          subtotal={documentSummary.total_amount}
          freightCost={freightCostNormalized}
          discountAmount={documentSummary.discount_amount}
          vatType={vatType as PrintVatType}
          vatRate={documentSummary.vat_rate}
          grandTotal={documentSummary.grand_total}
          discountText={discountText}
        />
        <Button
          type="button"
          size="lg"
          disabled={!canSave}
          onClick={handleSave}
          className="gap-2 bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500"
        >
          <PackagePlus className="size-4" />
          {isPending ? "กำลังบันทึก..." : "บันทึกรับสินค้าเข้าคลัง"}
        </Button>
      </div>
    </div>
  );
}
