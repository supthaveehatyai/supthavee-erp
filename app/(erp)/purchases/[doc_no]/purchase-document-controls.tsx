"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  requestPurchaseDocumentControl,
  revisePurchaseVatMode,
  voidAndClonePurchaseDocument,
} from "@/lib/actions/purchase-document-control";
import {
  previewPurchaseVatRevision,
  type PurchaseVatFigures,
  type PurchaseVatReviseMode,
} from "@/lib/utils/purchase-vat-revise";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const MODE_OPTIONS: { value: PurchaseVatReviseMode; label: string }[] = [
  { value: "INC_VAT", label: "ราคารวมภาษี (INC_VAT)" },
  { value: "EXC_VAT", label: "ภาษีนอก (EXC_VAT)" },
  { value: "NONE", label: "ไม่มีภาษี (NONE)" },
];

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function CompareRow({
  label,
  before,
  after,
}: {
  label: string;
  before: number;
  after: number;
}) {
  return (
    <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 text-sm">
      <span className="text-slate-600">{label}</span>
      <span className="text-right tabular-nums text-slate-500">{formatMoney(before)}</span>
      <span className="text-right font-semibold tabular-nums text-slate-900">
        {formatMoney(after)}
      </span>
    </div>
  );
}

export function PurchaseDocumentControls({
  isAdmin,
  documentId,
  docNo,
  goodsNet,
  originFreight,
  freightTaxMode,
  currentMode,
  current,
}: {
  isAdmin: boolean;
  documentId: string;
  docNo: string;
  goodsNet: number;
  originFreight: number;
  freightTaxMode?: string | null;
  currentMode: PurchaseVatReviseMode;
  current: PurchaseVatFigures;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [reviseOpen, setReviseOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [requestOpen, setRequestOpen] = useState(false);
  const [mode, setMode] = useState<PurchaseVatReviseMode>(currentMode);
  const [reason, setReason] = useState("");

  const preview = useMemo(
    () =>
      previewPurchaseVatRevision({
        goodsNet,
        originFreight,
        freightTaxMode,
        mode,
      }),
    [goodsNet, originFreight, freightTaxMode, mode],
  );

  function resetReason() {
    setReason("");
  }

  function submitRevise() {
    startTransition(async () => {
      const result = await revisePurchaseVatMode({ docNo, mode, reason });
      if (!result.success) {
        toast.error(result.error ?? "แก้ไขประเภทภาษีไม่สำเร็จ");
        return;
      }
      toast.success("ปรับปรุงประเภทภาษีแล้ว");
      setReviseOpen(false);
      resetReason();
      router.refresh();
    });
  }

  function submitClone() {
    startTransition(async () => {
      const result = await voidAndClonePurchaseDocument({
        documentId,
        docNo,
        reason,
      });
      if (!result.success || !result.docNo) {
        toast.error(result.error ?? "ยกเลิกและคัดลอกเอกสารไม่สำเร็จ");
        return;
      }
      toast.success(`ยกเลิก ${result.docNo} แล้ว เปิดหน้ารับสินค้าเพื่อออกใบใหม่`);
      router.push(
        `/purchases/manual-receipt?clone=${encodeURIComponent(result.docNo)}`,
      );
    });
  }

  function submitRequest() {
    startTransition(async () => {
      const result = await requestPurchaseDocumentControl({
        documentId,
        docNo,
        reason,
      });
      if (!result.success) {
        toast.error(result.error ?? "ส่งคำขอไม่สำเร็จ");
        return;
      }
      toast.success("ส่งคำขอเข้าศูนย์อนุมัติแล้ว");
      setRequestOpen(false);
      resetReason();
    });
  }

  return (
    <>
      {isAdmin ? (
        <>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={() => {
              setMode(currentMode);
              resetReason();
              setReviseOpen(true);
            }}
          >
            ปรับปรุงประเภทภาษี (Admin Revise)
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-10"
            onClick={() => {
              resetReason();
              setCloneOpen(true);
            }}
          >
            ยกเลิกและคัดลอกไปแก้ไขใหม่ (Void & Clone)
          </Button>
        </>
      ) : (
        <Button
          type="button"
          variant="outline"
          className="h-10"
          onClick={() => {
            resetReason();
            setRequestOpen(true);
          }}
        >
          ขออนุมัติแก้ไข/ยกเลิกเอกสาร
        </Button>
      )}

      <Dialog open={reviseOpen} onOpenChange={setReviseOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ปรับปรุงประเภทภาษี</DialogTitle>
            <DialogDescription>
              เอกสาร {docNo} ตรวจตัวเลขก่อนยืนยัน เหตุผลจะถูกบันทึกใน Audit Log
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="purchase-vat-mode">ประเภทภาษีใหม่</Label>
              <select
                id="purchase-vat-mode"
                className="flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm"
                value={mode}
                onChange={(event) => setMode(event.target.value as PurchaseVatReviseMode)}
              >
                {MODE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
              <div className="grid grid-cols-[1.4fr_1fr_1fr] gap-2 text-xs font-semibold text-slate-500">
                <span>รายการ</span>
                <span className="text-right">ก่อนแก้</span>
                <span className="text-right">หลังแก้</span>
              </div>
              <CompareRow
                label="ยอดรวมก่อนภาษี / ฐานต้นทุน TAS 2"
                before={current.preVatAmount}
                after={preview.preVatAmount}
              />
              <CompareRow
                label="ภาษีมูลค่าเพิ่ม 7%"
                before={current.vatAmount}
                after={preview.vatAmount}
              />
              <CompareRow
                label="ยอดสุทธิ Grand Total"
                before={current.grandTotal}
                after={preview.grandTotal}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="purchase-vat-reason">เหตุผลการแก้ไข (บันทึกเข้า Audit Log)</Label>
              <Textarea
                id="purchase-vat-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="เลือกโหมดภาษีผิดตอนคีย์รับสินค้า"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setReviseOpen(false)} disabled={pending}>
              ปิด
            </Button>
            <Button type="button" onClick={submitRevise} disabled={pending}>
              {pending ? "กำลังบันทึก..." : "ยืนยันแก้ไข"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cloneOpen} onOpenChange={setCloneOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ยกเลิกและคัดลอกไปแก้ไขใหม่</DialogTitle>
            <DialogDescription>
              เอกสาร {docNo} จะถูก Void แล้วเปิดหน้ารับสินค้าพร้อมผู้จำหน่าย เลขที่บิล รูปบิล และรายการสินค้าเดิม
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="purchase-clone-reason">เหตุผลการยกเลิก</Label>
            <Textarea
              id="purchase-clone-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="คีย์จำนวนสินค้าผิด"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCloneOpen(false)} disabled={pending}>
              ปิด
            </Button>
            <Button type="button" onClick={submitClone} disabled={pending}>
              {pending ? "กำลังยกเลิก..." : "ยืนยัน Void & Clone"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requestOpen} onOpenChange={setRequestOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ขออนุมัติแก้ไข/ยกเลิกเอกสาร</DialogTitle>
            <DialogDescription>
              คำขอของเอกสาร {docNo} จะไปที่ศูนย์อนุมัติ เพื่อให้ผู้บริหารพิจารณา
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="purchase-request-reason">เหตุผล</Label>
            <Textarea
              id="purchase-request-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="ต้องการให้ผู้บริหารตรวจการยกเลิกหรือแก้ไขภาษี"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setRequestOpen(false)} disabled={pending}>
              ปิด
            </Button>
            <Button type="button" onClick={submitRequest} disabled={pending}>
              {pending ? "กำลังส่ง..." : "ส่งคำขอ"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
