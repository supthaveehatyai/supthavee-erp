"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  matchVendorTaxInvoiceAction,
  togglePurchaseTaxInvoiceStatusAction,
} from "@/lib/actions/vendor-tax-invoice";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type TaxStatus = "TAX_READY" | "PENDING_TAX_INVOICE" | "CONSOLIDATED_CHILD" | null;

export function PurchaseTaxInvoiceControls({
  documentId,
  docNo,
  docType,
  docDate,
  referenceNo,
  grandTotal,
  taxInvoiceStatus,
}: {
  documentId: string;
  docNo: string;
  docType: string;
  docDate: string;
  referenceNo: string | null;
  grandTotal: number;
  taxInvoiceStatus: TaxStatus;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [confirmPending, setConfirmPending] = useState(false);
  const [matchOpen, setMatchOpen] = useState(false);
  const taxable = docType === "AP_TAX" || docType === "AP_CASH";
  const status =
    taxInvoiceStatus ?? (taxable ? "TAX_READY" : null);
  const defaultBase = useMemo(
    () => Math.round((grandTotal / 1.07) * 100) / 100,
    [grandTotal],
  );
  const [taxNo, setTaxNo] = useState(referenceNo?.trim() || docNo);
  const [taxDate, setTaxDate] = useState(docDate.slice(0, 10));
  const [baseInput, setBaseInput] = useState(defaultBase.toFixed(2));
  const [vatInput, setVatInput] = useState(
    (Math.round((grandTotal - defaultBase) * 100) / 100).toFixed(2),
  );
  const [adjustAp, setAdjustAp] = useState(false);

  if (!status) return null;

  function switchStatus(target: "PENDING_TAX_INVOICE" | "TAX_READY") {
    startTransition(async () => {
      const result = await togglePurchaseTaxInvoiceStatusAction(documentId, target);
      if (!result.success) {
        toast.error(result.error ?? "เปลี่ยนสถานะใบกำกับภาษีไม่สำเร็จ");
        return;
      }
      toast.success(
        target === "PENDING_TAX_INVOICE"
          ? "เปลี่ยนเป็นรอใบกำกับภาษีตัวจริงแล้ว"
          : "ใช้เลขบิลนี้เป็นใบกำกับภาษีแล้ว",
      );
      setConfirmPending(false);
      router.refresh();
    });
  }

  function submitMatch() {
    startTransition(async () => {
      const result = await matchVendorTaxInvoiceAction({
        documentIds: [documentId],
        taxInvoiceNo: taxNo,
        taxInvoiceDate: taxDate,
        actualTaxBase: Number(baseInput),
        actualVatAmount: Number(vatInput),
        adjustApToTaxInvoice: adjustAp,
      });
      if (!result.success) {
        toast.error(result.error ?? "ประกบใบกำกับภาษีไม่สำเร็จ");
        return;
      }
      toast.success("ประกบใบกำกับภาษีตัวจริงแล้ว");
      setMatchOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      {status === "TAX_READY" || status === "CONSOLIDATED_CHILD" ? (
        <Button
          type="button"
          variant="outline"
          className="h-10 border-orange-300 bg-orange-50 text-orange-900 hover:bg-orange-100"
          disabled={isPending}
          onClick={() => setConfirmPending(true)}
        >
          🟠 เปลี่ยนเป็น: รอใบกำกับภาษีตัวจริง
        </Button>
      ) : null}
      {status === "PENDING_TAX_INVOICE" ? (
        <>
          <span className="inline-flex h-10 items-center rounded-xl bg-orange-100 px-3 text-sm font-semibold text-orange-900">
            🟠 รอใบกำกับภาษีตัวจริง
          </span>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            disabled={isPending}
            onClick={() => setMatchOpen(true)}
          >
            📎 ประกบใบกำกับภาษี
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10 border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100"
            disabled={isPending}
            onClick={() => switchStatus("TAX_READY")}
          >
            🟢 ใช้เลขบิลนี้เป็นใบกำกับภาษี
          </Button>
        </>
      ) : null}

      <AlertDialog open={confirmPending} onOpenChange={setConfirmPending}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>เปลี่ยนสถานะใบกำกับภาษี</AlertDialogTitle>
            <AlertDialogDescription>
              {`เปลี่ยนสถานะเอกสาร ${docNo} เป็น 'รอใบกำกับภาษีตัวจริง' ใช่หรือไม่? (ไม่กระทบสต็อกและยอดหนี้)`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction
              disabled={isPending}
              onClick={() => switchStatus("PENDING_TAX_INVOICE")}
            >
              ยืนยัน
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={matchOpen} onOpenChange={setMatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>ประกบใบกำกับภาษี — {docNo}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="detail-tax-no">เลขที่ใบกำกับภาษีตัวจริง</Label>
              <Input id="detail-tax-no" value={taxNo} onChange={(event) => setTaxNo(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="detail-tax-date">วันที่ใบกำกับภาษี</Label>
              <Input
                id="detail-tax-date"
                type="date"
                value={taxDate}
                onChange={(event) => setTaxDate(event.target.value)}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="detail-tax-base">ฐานภาษี</Label>
                <Input
                  id="detail-tax-base"
                  type="number"
                  step="0.01"
                  value={baseInput}
                  onChange={(event) => setBaseInput(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="detail-tax-vat">ภาษีมูลค่าเพิ่ม</Label>
                <Input
                  id="detail-tax-vat"
                  type="number"
                  step="0.01"
                  value={vatInput}
                  onChange={(event) => setVatInput(event.target.value)}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-1"
                checked={adjustAp}
                onChange={(event) => setAdjustAp(event.target.checked)}
              />
              <span>ปรับยอดเจ้าหนี้ให้เท่ากับยอดใบกำกับภาษีจริง</span>
            </label>
          </div>
          <DialogFooter>
            <Button type="button" disabled={isPending} onClick={submitMatch}>
              {isPending ? "กำลังบันทึก..." : "ยืนยันประกบใบกำกับภาษี"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
