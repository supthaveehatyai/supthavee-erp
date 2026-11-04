"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AttachmentSheetViewer } from "@/components/shared/attachment-sheet-viewer";
import { attachSalesDocumentWhtCertificate, uploadDocumentImage } from "@/lib/actions/document-actions";
import {
  salesWhtAmount,
  salesWhtBase,
  SALES_WHT_RATE_OPTIONS,
} from "@/lib/finance/wht-base";
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

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function SalesWhtCertificatePanel({
  documentId,
  docNo,
  grandTotal,
  netBeforeVat,
  depositNetDeducted,
  depositDeducted,
  vatRate,
  shippingFee = 0,
  whtRate,
  whtAmount,
  netReceivedAmount,
  whtAttachmentUrl,
  whtStatus,
}: {
  documentId: string;
  docNo: string;
  grandTotal: number;
  netBeforeVat: number;
  depositNetDeducted: number;
  depositDeducted: number;
  vatRate: number;
  shippingFee?: number;
  whtRate: number;
  whtAmount: number;
  netReceivedAmount: number;
  whtAttachmentUrl: string | null;
  whtStatus: "NONE" | "PENDING_CERT" | "RECEIVED";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [rate, setRate] = useState(whtRate > 0 ? String(whtRate) : "3");
  const [amountText, setAmountText] = useState(
    whtAmount > 0 ? whtAmount.toFixed(2) : "",
  );
  const [fileUrl, setFileUrl] = useState(whtAttachmentUrl ?? "");
  const [fileName, setFileName] = useState("");
  const [uploading, setUploading] = useState(false);

  const status =
    whtStatus === "RECEIVED" || whtAttachmentUrl
      ? "RECEIVED"
      : whtAmount > 0
        ? "PENDING_CERT"
        : "NONE";
  const base = salesWhtBase({
    payAmount: grandTotal,
    remainingGrand: grandTotal,
    grandTotal,
    netBeforeVat,
    depositNetDeducted,
    depositDeducted,
    paidAmount: 0,
    vatRate,
    shippingFee,
  });

  function openDialog() {
    const nextRate = whtRate > 0 ? String(whtRate) : "3";
    setRate(nextRate);
    setAmountText(
      whtAmount > 0
        ? whtAmount.toFixed(2)
        : salesWhtAmount(base, Number(nextRate)).toFixed(2),
    );
    setFileUrl(whtAttachmentUrl ?? "");
    setFileName("");
    setOpen(true);
  }

  function changeRate(nextRate: string) {
    setRate(nextRate);
    setAmountText(salesWhtAmount(base, Number(nextRate)).toFixed(2));
  }

  async function uploadFile(file: File | null) {
    if (!file || file.size <= 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const uploaded = await uploadDocumentImage(formData);
      if (uploaded.error || !uploaded.data?.url) {
        toast.error(uploaded.error ?? "อัปโหลดใบ 50 ทวิไม่สำเร็จ");
        return;
      }
      setFileUrl(uploaded.data.url);
      setFileName(file.name);
    } finally {
      setUploading(false);
    }
  }

  function save() {
    const amount = roundMoney(Number(amountText));
    if (!Number.isFinite(amount) || amount < 0 || (Number(rate) <= 0 && amount <= 0)) {
      toast.error("ระบุอัตราหรือยอดหัก ณ ที่จ่าย");
      return;
    }
    startTransition(async () => {
      const result = await attachSalesDocumentWhtCertificate({
        document_id: documentId,
        wht_rate: Number(rate) || 0,
        wht_amount: amount,
        wht_attachment_url: fileUrl || null,
      });
      if (result.error || !result.data) {
        toast.error(result.error ?? "บันทึกใบหัก ณ ที่จ่ายไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกใบหัก ณ ที่จ่ายแล้ว");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="space-y-2 border-t border-slate-200 pt-2.5">
      {whtAmount > 0.005 ? (
        <>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-600">
              หัก ณ ที่จ่าย ({formatMoney(whtRate)}% ของฐานก่อน VAT)
            </span>
            <span className="font-medium text-rose-700">−{formatMoney(whtAmount)} ฿</span>
          </div>
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-slate-600">ยอดรับโอนสุทธิจริง</span>
            <span className="font-semibold text-slate-900">
              {formatMoney(netReceivedAmount)} ฿
            </span>
          </div>
        </>
      ) : null}
      {status === "PENDING_CERT" ? (
        <div className="rounded-lg border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
          <p className="font-semibold">⏳ รอใบหัก ณ ที่จ่าย (50 ทวิ)</p>
          <Button
            type="button"
            className="mt-2 h-9 bg-orange-600 text-white hover:bg-orange-700"
            onClick={openDialog}
          >
            📤 แนบใบหัก ณ ที่จ่าย (50 ทวิ)
          </Button>
        </div>
      ) : null}
      {status === "RECEIVED" && whtAttachmentUrl ? (
        <div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
          <p className="text-sm font-semibold text-emerald-800">✅ ได้รับใบ 50 ทวิแล้ว</p>
          <div className="flex flex-wrap gap-2">
            <AttachmentSheetViewer
              fileUrl={whtAttachmentUrl}
              title={`ใบหัก ณ ที่จ่าย · ${docNo}`}
              trigger={
                <button
                  type="button"
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-3 text-sm font-semibold text-emerald-800"
                >
                  <Eye className="size-4" />
                  👁️ ดูใบหัก ณ ที่จ่าย (50 ทวิ)
                </button>
              }
            />
            <Button type="button" variant="outline" className="h-9" onClick={openDialog}>
              🔄 เปลี่ยนไฟล์ 50 ทวิ
            </Button>
          </div>
        </div>
      ) : null}
      {whtAmount <= 0.005 ? (
        <Button type="button" variant="outline" className="h-9" onClick={openDialog}>
          📄 บันทึก/แนบใบหัก ณ ที่จ่าย (50 ทวิ)
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ใบหัก ณ ที่จ่าย (50 ทวิ) · {docNo}</DialogTitle>
            <DialogDescription>
              บันทึกยอดหัก ณ ที่จ่ายจากฐานก่อน VAT และแนบรูปใบ 50 ทวิได้โดยไม่ยกเลิกบิล
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="later-wht-rate">อัตราหัก ณ ที่จ่าย</Label>
              <select
                id="later-wht-rate"
                value={rate}
                onChange={(event) => changeRate(event.target.value)}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                {SALES_WHT_RATE_OPTIONS.filter((option) => option > 0).map((option) => (
                  <option key={option} value={String(option)}>
                    {option}%
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="later-wht-amount">ยอดภาษีหัก ณ ที่จ่าย (บาท)</Label>
              <Input
                id="later-wht-amount"
                inputMode="decimal"
                value={amountText}
                onChange={(event) => setAmountText(event.target.value)}
              />
              <p className="text-xs text-slate-600">
                ฐานก่อน VAT {formatMoney(base)} ฿ · หัก ณ ที่จ่าย ({rate}%) ={" "}
                {formatMoney(roundMoney(Number(amountText) || 0))} ฿
              </p>
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
                void uploadFile(event.dataTransfer.files?.[0] ?? null);
              }}
            >
              <Label htmlFor="later-wht-file">📄 แนบหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ)</Label>
              <Input
                id="later-wht-file"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) => {
                  void uploadFile(event.target.files?.[0] ?? null);
                }}
              />
              {uploading ? (
                <p className="text-xs text-slate-500">กำลังอัปโหลด...</p>
              ) : fileName ? (
                <p className="text-xs text-slate-500">{fileName}</p>
              ) : fileUrl ? (
                <p className="text-xs text-slate-500">มีไฟล์เดิมอยู่แล้ว</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button type="button" disabled={pending || uploading} onClick={save}>
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              บันทึกใบ 50 ทวิ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
