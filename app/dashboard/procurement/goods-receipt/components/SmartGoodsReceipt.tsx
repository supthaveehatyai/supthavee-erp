"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  PackageCheck,
  ScanLine,
  Warehouse,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { VendorSelect } from "@/app/dashboard/procurement/vendor-mapping/vendor-select";
import { getActiveVendors } from "@/lib/actions/mapping";
import type { VendorOption } from "@/lib/actions/mapping";
import { uploadBillAndProcessOcr } from "../lib/upload-bill-ocr";
import type { OcrVerificationItem, OcrVerificationRow } from "../types";
import { InvoiceDropzone } from "./InvoiceDropzone";
import SmartGoodsReceiptTable from "./SmartGoodsReceiptTable";

export type SmartGoodsReceiptProps = {
  className?: string;
  /**
   * Called when user confirms receive — ready rows only.
   * Inventory Ledger commit is wired in a later Phase 3 step.
   */
  onConfirmReceive?: (rows: OcrVerificationRow[]) => void | Promise<void>;
};

/**
 * Phase 3 — Smart Goods Receipt
 *
 * 1. Smart Combobox: select vendor_id
 * 2. Drag-and-drop invoice image → Base64 → process-receipt-ocr
 * 3. Loading state while Edge Function runs
 * 4. Map raw_vendor_sku JSON → shadcn/ui review table
 * 5. Confirm before writing Inventory Ledger
 */
export default function SmartGoodsReceipt({
  className,
  onConfirmReceive,
}: SmartGoodsReceiptProps) {
  const [vendors, setVendors] = useState<VendorOption[]>([]);
  const [vendorId, setVendorId] = useState("");
  const [isBootLoading, setIsBootLoading] = useState(true);

  const [reviewItems, setReviewItems] = useState<OcrVerificationItem[]>([]);
  const [reviewRows, setReviewRows] = useState<OcrVerificationRow[]>([]);
  const [isOcrRunning, setIsOcrRunning] = useState(false);
  const [ocrMetaLabel, setOcrMetaLabel] = useState("");
  const [fileName, setFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  const selectedVendor = useMemo(
    () => vendors.find((item) => item.id === vendorId) ?? null,
    [vendors, vendorId],
  );

  const stats = useMemo(() => {
    const ready = reviewRows.filter((row) => row.status === "ready").length;
    const unmatched = reviewRows.filter(
      (row) => row.status === "action_required",
    ).length;
    return {
      total: reviewRows.length,
      ready,
      unmatched,
      allReady: reviewRows.length > 0 && unmatched === 0,
    };
  }, [reviewRows]);

  useEffect(() => {
    let active = true;
    void (async () => {
      setIsBootLoading(true);
      const result = await getActiveVendors();
      if (!active) return;
      if (result.error) {
        toast.error(`โหลดผู้จำหน่ายไม่สำเร็จ: ${result.error}`);
        setVendors([]);
      } else {
        setVendors(result.data);
      }
      setIsBootLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const clearInvoice = useCallback(() => {
    setFileName("");
    setOcrMetaLabel("");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }, [previewUrl]);

  const handleFileSelected = useCallback(
    async (file: File) => {
      if (!vendorId) {
        toast.error("เลือกผู้จำหน่าย (Vendor) ก่อนอัปโหลดบิล");
        return;
      }

      setIsOcrRunning(true);
      setFileName(file.name);
      setOcrMetaLabel("");

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(
        file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      );

      const result = await uploadBillAndProcessOcr({
        file,
        vendorId,
      });

      setIsOcrRunning(false);

      if (result.error) {
        toast.error(result.error);
        return;
      }

      setReviewItems(result.items);
      setOcrMetaLabel(
        result.meta
          ? `${result.meta.line_count} รายการ · ${result.meta.model}`
          : `${result.items.length} รายการ`,
      );
      toast.success(
        `OCR สำเร็จ — พบ ${result.items.length.toLocaleString("th-TH")} รหัส raw_vendor_sku`,
      );
    },
    [vendorId, previewUrl],
  );

  async function handleConfirmReceive() {
    if (!stats.allReady) {
      toast.error("จับคู่รายการ Unmatched ให้ครบก่อนบันทึกลง Inventory Ledger");
      return;
    }

    const readyRows = reviewRows.filter((row) => row.status === "ready");
    setIsConfirming(true);

    try {
      if (onConfirmReceive) {
        await onConfirmReceive(readyRows);
      } else {
        // Stub until INT_REC + inventory_ledger commit is implemented
        toast.message(
          `พร้อมบันทึก ${readyRows.length.toLocaleString("th-TH")} รายการเข้า Inventory Ledger (รอรอบ commit ถัดไป)`,
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "บันทึกรับของไม่สำเร็จ",
      );
    } finally {
      setIsConfirming(false);
    }
  }

  return (
    <div className={cn("mx-auto flex max-w-[1400px] flex-col gap-5", className)}>
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold text-blue-600">
            PHASE 3 · PROCUREMENT
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
            Smart Goods Receipt
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            ลากวางรูปบิล → Base64 + vendor_id → Gemini OCR → ตรวจทาน{" "}
            <code className="text-xs">raw_vendor_sku</code> ก่อนตัดเข้า Inventory
            Ledger
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
              Ready
            </p>
            <p className="text-lg font-bold text-emerald-700">
              {stats.ready.toLocaleString("th-TH")}
            </p>
          </div>
          <div className="rounded-xl bg-red-50 px-3 py-2 text-center">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-red-600">
              Unmatched
            </p>
            <p className="text-lg font-bold text-red-700">
              {stats.unmatched.toLocaleString("th-TH")}
            </p>
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ScanLine className="size-4 text-blue-600" aria-hidden />
              1. ผู้จำหน่าย (Smart Combobox)
            </CardTitle>
            <CardDescription>
              เลือก Vendor เพื่อดึง{" "}
              <code className="text-xs">ocr_pattern_config</code> และค้นหา mapping
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label className="mb-1.5 block text-xs font-semibold text-slate-700">
                Vendor <span className="text-red-500">*</span>
              </Label>
              <VendorSelect
                vendors={vendors}
                value={vendorId}
                onChange={(nextId) => {
                  setVendorId(nextId);
                  // Reset OCR results when switching vendor — mappings differ
                  setReviewItems([]);
                  setReviewRows([]);
                  setOcrMetaLabel("");
                }}
                disabled={isBootLoading || isOcrRunning}
              />
            </div>
            {selectedVendor ? (
              <p className="rounded-lg bg-blue-50 px-3 py-2 text-[11px] text-blue-800">
                เลือกแล้ว: <strong>{selectedVendor.company_name}</strong>
              </p>
            ) : (
              <p className="text-[11px] font-medium text-amber-600">
                ต้องเลือก Vendor ก่อนจึงจะอัปโหลดบิลได้
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PackageCheck className="size-4 text-blue-600" aria-hidden />
              2. อัปโหลดรูปบิล (Drag & Drop)
            </CardTitle>
            <CardDescription>
              แปลงเป็น Base64 แล้ว POST ไป Edge Function{" "}
              <code className="text-xs">process-receipt-ocr</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <InvoiceDropzone
              disabled={!vendorId || isBootLoading}
              isProcessing={isOcrRunning}
              fileName={fileName}
              previewUrl={previewUrl}
              onFileSelected={(file) => void handleFileSelected(file)}
              onClear={clearInvoice}
            />
            {ocrMetaLabel ? (
              <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-700">
                <CheckCircle2 className="size-3.5" aria-hidden />
                OCR เสร็จ: {ocrMetaLabel}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <section className="space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">
              3. ตารางตรวจทาน (raw_vendor_sku)
            </h2>
            <p className="mt-0.5 text-xs text-slate-500">
              ตรวจสอบ On-the-fly mapping ให้ครบก่อนบันทึกลง Inventory Ledger
            </p>
          </div>
          <Button
            type="button"
            disabled={
              !stats.allReady || isOcrRunning || isConfirming || stats.total === 0
            }
            onClick={() => void handleConfirmReceive()}
            className="shrink-0"
          >
            <Warehouse className="size-4" aria-hidden />
            {isConfirming
              ? "กำลังบันทึก…"
              : `ยืนยันรับของเข้า Ledger (${stats.ready})`}
          </Button>
        </div>

        {reviewItems.length === 0 && !isOcrRunning ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <div className="grid size-12 place-items-center rounded-2xl bg-slate-100 text-slate-400">
                <ScanLine className="size-5" aria-hidden />
              </div>
              <p className="text-sm font-semibold text-slate-700">
                ยังไม่มีรายการ OCR
              </p>
              <p className="max-w-sm text-xs text-slate-400">
                เลือก Vendor แล้วลากวางรูปบิล — ระบบจะแปลง Base64 เรียก AI
                และแสดง raw_vendor_sku ในตารางนี้
              </p>
            </CardContent>
          </Card>
        ) : (
          <SmartGoodsReceiptTable
            vendorId={vendorId}
            items={reviewItems}
            isProcessing={isOcrRunning}
            onRowsChange={setReviewRows}
          />
        )}
      </section>
    </div>
  );
}
