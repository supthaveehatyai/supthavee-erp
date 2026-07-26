"use client";

/**
 * "Save to Ledger" confirmation dialog — the last checkpoint before
 * `saveGoodsReceiptToLedger` writes `doc_headers`/`doc_details` +
 * `inventory_ledger`. Replaces the old `window.prompt` flow so the user can
 * review/edit BOTH the invoice number and invoice date Gemini extracted.
 *
 * Zero Client-Side Fetching: the only network call this component makes is
 * `checkDuplicateInvoice` (a Server Action) — the Early Warning check for
 * `doc_headers_contact_doc_no_date_key` (vendor + doc_no + doc_date).
 */

import { useEffect, useState } from "react";
import { AlertTriangle, Loader2, PackageCheck } from "lucide-react";
import { checkDuplicateInvoice } from "@/lib/actions/receipt";
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

export type SaveToLedgerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  initialDocNumber: string;
  initialDocDate: string;
  matchedCount: number;
  isSaving: boolean;
  onConfirm: (docNumber: string, docDate: string) => void;
};

export default function SaveToLedgerDialog({
  open,
  onOpenChange,
  vendorId,
  initialDocNumber,
  initialDocDate,
  matchedCount,
  isSaving,
  onConfirm,
}: SaveToLedgerDialogProps) {
  const [docNumber, setDocNumber] = useState(initialDocNumber);
  const [docDate, setDocDate] = useState(initialDocDate);

  const [duplicateCheck, setDuplicateCheck] = useState<{
    isDuplicate: boolean;
    isChecking: boolean;
  }>({ isDuplicate: false, isChecking: false });

  // Reset the form to the latest OCR values every time the dialog
  // transitions from closed -> open (adjusting state during render,
  // React-sanctioned, instead of a `useEffect`).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) {
      setDocNumber(initialDocNumber);
      setDocDate(initialDocDate);
    }
  }

  /**
   * Early Warning check — debounced, fires on open and whenever the vendor,
   * doc number, or doc date change, matching the
   * `doc_headers_contact_doc_no_date_key` composite UNIQUE constraint
   * exactly (vendor_id + doc_no + doc_date).
   */
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
            // Fail-open: don't block confirmation on a check-failure.
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
    onConfirm(docNumber.trim(), docDate.trim());
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !isSaving && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกรับสินค้าเข้าคลัง (Save to Ledger)</DialogTitle>
          <DialogDescription>
            ตรวจสอบ/แก้ไขเลขที่และวันที่เอกสารอ้างอิงก่อนบันทึก —{" "}
            {matchedCount.toLocaleString("th-TH")} รายการที่จับคู่แล้วจะถูกบันทึกเข้าคลัง
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
