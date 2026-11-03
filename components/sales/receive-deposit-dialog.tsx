"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { createDepositDocument } from "@/app/actions/finance/deposit-actions";
import { parseTransferSlipOcr } from "@/lib/actions/sales-ocr-actions";
import { formatBuddhistSlash } from "@/lib/utils/deposit-note";
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
import {
  calculateDocumentSummary,
  type VatCalculationType,
} from "@/lib/utils/document-summary";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function chunkStep(value: number): number {
  return value >= 10000 ? 1000 : 100;
}

function roundDownChunk(value: number): number {
  const step = chunkStep(value);
  return Math.floor(value / step) * step;
}

function roundUpChunk(value: number): number {
  const step = chunkStep(value);
  const down = roundDownChunk(value);
  return Math.abs(down - value) < 0.001 ? value : down + step;
}

export function ReceiveDepositDialog({
  documentId,
  docNo,
  contactId,
  customerName,
  orderTotal,
}: {
  documentId: string;
  docNo: string;
  contactId: string;
  customerName: string;
  orderTotal: number;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [vatType, setVatType] = useState<VatCalculationType>("INCLUSIVE");
  const [documentDate, setDocumentDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [referenceNo, setReferenceNo] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [isReadingSlip, setIsReadingSlip] = useState(false);
  const [isPending, startTransition] = useTransition();

  const half = Math.round(Math.max(0, orderTotal) * 50) / 100;
  const summary = useMemo(() => {
    const raw = Number(amount);
    const lineAmount = Number.isFinite(raw) && raw > 0 ? raw : 0;
    return calculateDocumentSummary({
      lineTotals: [lineAmount],
      vatType,
      vatRate: vatType === "NONE" ? 0 : 7,
    });
  }, [amount, vatType]);

  function choose(value: number) {
    setAmount(value > 0 ? value.toFixed(2) : "");
  }

  async function readSlip(file: File | null) {
    if (!file || file.size <= 0) {
      setSlipFile(null);
      return;
    }
    setSlipFile(file);
    setIsReadingSlip(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await parseTransferSlipOcr(formData);
      if (result.error || !result.data) {
        toast.error(result.error ?? "อ่านสลิปไม่สำเร็จ");
        return;
      }
      if (result.data.doc_date) {
        setDocumentDate(result.data.doc_date);
        toast.success(
          `ดึงวันที่โอนจากสลิป: ${formatBuddhistSlash(result.data.doc_date)} อัตโนมัติ`,
        );
      }
      if (result.data.reference_no) setReferenceNo(result.data.reference_no);
      if (result.data.amount && !(Number(amount) > 0)) {
        setAmount(result.data.amount.toFixed(2));
      }
    } finally {
      setIsReadingSlip(false);
    }
  }

  function handleSubmit() {
    const raw = Number(amount);
    if (!Number.isFinite(raw) || raw <= 0) {
      toast.error("กรุณาระบุยอดเงินมัดจำ");
      return;
    }
    const formData = new FormData();
    formData.set("doc_type", "DEP_IN");
    formData.set("contact_id", contactId);
    formData.set("document_date", documentDate);
    formData.set("amount", raw.toFixed(2));
    formData.set("vat_type", vatType);
    formData.set("vat_rate", "7");
    formData.set("reference_no", referenceNo.trim());
    formData.set("ref_document_id", documentId);
    formData.set("mark_paid", "1");
    if (slipFile) formData.set("slip_file", slipFile);

    startTransition(async () => {
      const result = await createDepositDocument(formData);
      if (!result.success) {
        toast.error(result.error ?? "ออกใบมัดจำไม่สำเร็จ");
        return;
      }
      toast.success(`ออกใบมัดจำ ${result.doc_no ?? ""} แล้ว`);
      setOpen(false);
      setAmount("");
      setReferenceNo("");
      setSlipFile(null);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="h-10 gap-2 border-amber-200 bg-amber-50 font-semibold text-amber-900 hover:bg-amber-100"
        onClick={() => setOpen(true)}
      >
        <HandCoins className="size-4" />
        💰 รับเงินมัดจำ (ออกใบกำกับภาษีมัดจำ)
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>รับเงินมัดจำจาก {docNo}</DialogTitle>
            <DialogDescription>
              ลูกค้า {customerName} · ออกใบเสร็จรับเงิน/ใบกำกับภาษีมัดจำ (DEP_IN)
              และผูกกับบิลนี้ทันที
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
              ยอดเอกสาร {formatMoney(orderTotal)} ฿
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => choose(half)}>
                50% พอดี ({formatMoney(half)} ฿)
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => choose(roundDownChunk(half))}
              >
                50% ปัดลงก้อนกลม ({formatMoney(roundDownChunk(half))} ฿)
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => choose(roundUpChunk(half))}
              >
                50% ปัดขึ้นก้อนกลม ({formatMoney(roundUpChunk(half))} ฿)
              </Button>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deposit-date">วันที่รับเงินมัดจำ</Label>
              <Input
                id="deposit-date"
                type="date"
                value={documentDate}
                onChange={(event) => setDocumentDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deposit-amount">ยอดมัดจำก้อนกลม</Label>
              <Input
                id="deposit-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deposit-vat">ประเภท VAT</Label>
              <select
                id="deposit-vat"
                value={vatType}
                onChange={(event) =>
                  setVatType(event.target.value as VatCalculationType)
                }
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="INCLUSIVE">
                  INCLUSIVE — รวมภาษีมูลค่าเพิ่ม 7% (VAT ใน)
                </option>
                <option value="EXCLUSIVE">EXCLUSIVE — แยกภาษี (VAT นอก)</option>
                <option value="NONE">NONE — ไม่มี VAT</option>
              </select>
            </div>
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {vatType === "INCLUSIVE"
                ? `รับโอน ${formatMoney(summary.grand_total)} ฿ = มูลค่าก่อนภาษี ${formatMoney(summary.net_before_vat)} ฿ + VAT ${formatMoney(summary.vat_amount)} ฿`
                : vatType === "EXCLUSIVE"
                  ? `ฐาน ${formatMoney(summary.net_before_vat)} ฿ + VAT ${formatMoney(summary.vat_amount)} ฿ = ยอดรับ ${formatMoney(summary.grand_total)} ฿`
                  : `ยอดมัดจำ ${formatMoney(summary.grand_total)} ฿ (ไม่มี VAT)`}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="deposit-ref">เลขที่อ้างอิงสลิป</Label>
              <Input
                id="deposit-ref"
                value={referenceNo}
                onChange={(event) => setReferenceNo(event.target.value)}
                placeholder="เช่น เลขอ้างอิงโอน"
              />
            </div>
            <div
              className="space-y-1.5"
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void readSlip(event.dataTransfer.files?.[0] ?? null);
              }}
            >
              <Label htmlFor="deposit-slip">แนบสลิปโอนเงิน</Label>
              <Input
                id="deposit-slip"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) => {
                  void readSlip(event.target.files?.[0] ?? null);
                }}
              />
              {isReadingSlip ? (
                <p className="text-xs text-slate-500">กำลังอ่านวันที่และเลขสลิป...</p>
              ) : slipFile ? (
                <p className="text-xs text-slate-500">{slipFile.name}</p>
              ) : null}
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              disabled={isPending || isReadingSlip}
              onClick={handleSubmit}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              ยืนยันออกใบมัดจำ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
