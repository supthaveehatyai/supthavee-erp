"use client";

/**
 * "Save to Ledger" confirmation dialog — the last checkpoint before
 * `saveGoodsReceiptToLedger` writes `doc_headers`/`doc_details` +
 * Phase 4 `documents` + `inventory_ledger`.
 *
 * Zero Client-Side Fetching: the only network call this component makes is
 * `checkDuplicateInvoice` (a Server Action).
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, PackageCheck } from "lucide-react";
import { checkDuplicateInvoice } from "@/lib/actions/receipt";
import type { GoodsReceiptDocType } from "@/lib/constants/document";
import { VAT_OPTIONS } from "@/lib/constants/accounting";
import type { VatCalculationType } from "@/lib/utils/document-summary";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type SaveToLedgerConfirmPayload = {
  docNumber: string;
  docDate: string;
  billDiscountText: string;
  docType: GoodsReceiptDocType;
  vatType: VatCalculationType;
};

export type SaveToLedgerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  initialDocNumber: string;
  initialDocDate: string;
  initialBillDiscountText: string;
  /** AI-suggested document type (human can override). */
  initialDocType?: GoodsReceiptDocType;
  /** AI-suggested VAT type (human can override). */
  initialVatType?: VatCalculationType;
  matchedCount: number;
  isSaving: boolean;
  onConfirm: (payload: SaveToLedgerConfirmPayload) => void;
};

const selectClassName = cn(
  "flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 shadow-sm outline-none transition",
  "focus:border-blue-400 focus:ring-2 focus:ring-blue-100",
  "disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400",
);

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


export default function SaveToLedgerDialog({
  open,
  onOpenChange,
  vendorId,
  initialDocNumber,
  initialDocDate,
  initialBillDiscountText,
  initialDocType = "AP_TAX",
  initialVatType = "NONE",
  matchedCount,
  isSaving,
  onConfirm,
}: SaveToLedgerDialogProps) {
  const [docNumber, setDocNumber] = useState(initialDocNumber);
  const [docDate, setDocDate] = useState(initialDocDate);
  const [billDiscountText, setBillDiscountText] = useState(initialBillDiscountText);
  const [docType, setDocType] = useState<GoodsReceiptDocType>(
    initialDocType === "AP_TAX" ||
      initialDocType === "AP_INV" ||
      initialDocType === "AP_CASH"
      ? initialDocType
      : "AP_TAX",
  );
  const [vatType, setVatType] = useState<VatCalculationType>(initialVatType);

  const [duplicateCheck, setDuplicateCheck] = useState<{
    isDuplicate: boolean;
    isChecking: boolean;
  }>({ isDuplicate: false, isChecking: false });

  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDocNumber(initialDocNumber);
      setDocDate(initialDocDate);
      setBillDiscountText(initialBillDiscountText);
      setDocType(
        initialDocType === "AP_TAX" ||
          initialDocType === "AP_INV" ||
          initialDocType === "AP_CASH"
          ? initialDocType
          : "AP_TAX",
      );
      setVatType(initialVatType);
    }
  }

  useEffect(() => {
    if (!open) return;

    const trimmedDocNumber = docNumber.trim();
    const trimmedDocDate = docDate.trim();
    if (!vendorId || !trimmedDocNumber || !trimmedDocDate) {
      setDuplicateCheck({ isDuplicate: false, isChecking: false });
      return;
    }

    let cancelled = false;
    setDuplicateCheck((current) => ({ ...current, isChecking: true }));

    const timer = setTimeout(() => {
      void checkDuplicateInvoice(vendorId, trimmedDocNumber, trimmedDocDate).then(
        (result) => {
          if (cancelled) return;
          if (result.error) {
            setDuplicateCheck({ isDuplicate: false, isChecking: false });
            return;
          }
          setDuplicateCheck({ isDuplicate: result.isDuplicate, isChecking: false });
        },
      );
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, vendorId, docNumber, docDate]);

  const isDuplicate = duplicateCheck.isDuplicate;
  const canConfirm =
    !isSaving &&
    !duplicateCheck.isChecking &&
    !isDuplicate &&
    docNumber.trim().length > 0 &&
    docDate.trim().length > 0;

  function handleConfirm() {
    if (!canConfirm) return;
    onConfirm({
      docNumber: docNumber.trim(),
      docDate: docDate.trim(),
      billDiscountText: billDiscountText.trim(),
      docType,
      vatType,
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกรับสินค้าเข้าคลัง (Save to Ledger)</DialogTitle>
          <DialogDescription>
            ตรวจสอบเลขที่ / วันที่ / ประเภทเอกสารและภาษีก่อนบันทึก — ค่าเริ่มต้นมาจาก AI
            (แก้ไขได้หากอ่านพลาด) · {matchedCount.toLocaleString("th-TH")} รายการที่จับคู่แล้วจะถูกบันทึกเข้าคลัง
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="save-ledger-doc-number">เลขที่เอกสารอ้างอิง</Label>
            <Input
              id="save-ledger-doc-number"
              value={docNumber}
              onChange={(e) => setDocNumber(e.target.value)}
              placeholder="เช่น INV-24011234"
              disabled={isSaving}
              className={isDuplicate ? "border-red-400 focus-visible:ring-red-400" : ""}
              autoFocus
            />
          </div>
          <div>
            <Label htmlFor="save-ledger-doc-date">วันที่เอกสาร</Label>
            <Input
              id="save-ledger-doc-date"
              type="date"
              value={docDate}
              onChange={(e) => setDocDate(e.target.value)}
              disabled={isSaving}
              className={isDuplicate ? "border-red-400 focus-visible:ring-red-400" : ""}
            />
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="save-ledger-doc-type">ประเภทเอกสาร (Document Type)</Label>
            <select
              id="save-ledger-doc-type"
              value={docType}
              onChange={(e) => setDocType(e.target.value as GoodsReceiptDocType)}
              disabled={isSaving}
              className={selectClassName}
            >
              {DOC_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="save-ledger-vat-type">ประเภทภาษี (VAT Type)</Label>
            <select
              id="save-ledger-vat-type"
              value={vatType}
              onChange={(e) => setVatType(e.target.value as VatCalculationType)}
              disabled={isSaving}
              className={selectClassName}
            >
              {VAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-3">
          <Label htmlFor="save-ledger-bill-discount">ส่วนลดท้ายบิล (%, บาท)</Label>
          <Input
            id="save-ledger-bill-discount"
            value={billDiscountText}
            onChange={(e) => setBillDiscountText(e.target.value)}
            placeholder="เช่น 40%, 1500"
            disabled={isSaving}
          />
          <p className="mt-1 text-[11px] text-slate-400">
            เช่น 40%, 1500 — ระบบจะกระจายส่วนลดนี้ลงทุกรายการตามสัดส่วนมูลค่า
            {vatType === "INCLUSIVE"
              ? " (โหมดรวมภาษี: ถอด VAT 7% ออกก่อนคำนวณต้นทุน LPP)"
              : ""}
          </p>
        </div>

        {isDuplicate && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm font-semibold text-red-700">
            <AlertTriangle className="size-4 shrink-0" aria-hidden />
            <span>⚠️ บิลเลขที่และวันที่นี้ ถูกบันทึกเข้าระบบแล้ว</span>
          </div>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isSaving}
            onClick={() => onOpenChange(false)}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            className="bg-emerald-600 hover:bg-emerald-700 focus-visible:ring-emerald-500"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            {isSaving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <PackageCheck className="size-4" aria-hidden />
            )}
            {isSaving ? "กำลังบันทึก..." : "ยืนยันบันทึก"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
