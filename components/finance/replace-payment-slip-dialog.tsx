"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  replacePaymentSlipAction,
  uploadReplacementPaymentSlipAction,
} from "@/app/actions/finance/ap-actions";
import { compressSlipJpeg } from "@/lib/utils/image-compression";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ReplacePaymentSlipDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voucherDocId: string;
  partyName: string;
  netAmount: number;
  onSaved?: () => void;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ReplacePaymentSlipDialog({
  open,
  onOpenChange,
  voucherDocId,
  partyName,
  netAmount,
  onSaved,
}: ReplacePaymentSlipDialogProps) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [paymentDate, setPaymentDate] = useState("");
  const [referenceNo, setReferenceNo] = useState("");
  const [zoom, setZoom] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (open) return;
    setFile(null);
    setPaymentDate("");
    setReferenceNo("");
    setZoom(false);
  }, [open]);

  async function handleFile(fileList: FileList | null) {
    const next = fileList?.[0] ?? null;
    if (!next) {
      setFile(null);
      return;
    }
    const mime = (next.type || "").toLowerCase();
    if (mime === "application/pdf" || next.name.toLowerCase().endsWith(".pdf")) {
      setFile(next);
      return;
    }
    if (!mime.startsWith("image/")) {
      toast.error("แนบได้เฉพาะไฟล์รูปภาพ หรือ PDF");
      return;
    }
    try {
      setFile(await compressSlipJpeg(next));
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "บีบอัดสลิปไม่สำเร็จ");
      setFile(null);
    }
  }

  async function save() {
    if (!file || !voucherDocId) {
      toast.error("กรุณาเลือกไฟล์สลิปใหม่");
      return;
    }
    setSaving(true);
    try {
      const formData = new FormData();
      formData.set("slip_file", file);
      const uploaded = await uploadReplacementPaymentSlipAction(formData);
      if (!uploaded.success || !uploaded.url) {
        toast.error(uploaded.error ?? "อัปโหลดสลิปไม่สำเร็จ");
        return;
      }
      const replaced = await replacePaymentSlipAction({
        voucherDocId,
        newSlipUrl: uploaded.url,
        paymentDate: paymentDate || undefined,
        referenceNo: referenceNo || undefined,
      });
      if (!replaced.success) {
        toast.error(replaced.error ?? "เปลี่ยนสลิปไม่สำเร็จ");
        return;
      }
      toast.success("เปลี่ยนสลิปเรียบร้อยแล้ว");
      onOpenChange(false);
      onSaved?.();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  const isPdf = file?.type === "application/pdf" || file?.name.toLowerCase().endsWith(".pdf");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>🔄 เปลี่ยนสลิป</DialogTitle>
            <DialogDescription>
              อัปโหลดสลิปใบใหม่ของใบสำคัญเดิม โดยไม่ลบเอกสารและไม่ตัดจ่ายใหม่
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="replace-slip-date">วันที่บนสลิป (ถ้าต้องการแก้)</Label>
                <Input
                  id="replace-slip-date"
                  type="date"
                  value={paymentDate}
                  onChange={(event) => setPaymentDate(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="replace-slip-ref">เลขอ้างอิงสลิป (ถ้ามี)</Label>
                <Input
                  id="replace-slip-ref"
                  value={referenceNo}
                  onChange={(event) => setReferenceNo(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="replace-slip-file">ไฟล์สลิปใหม่</Label>
              <Input
                id="replace-slip-file"
                type="file"
                accept="image/*,application/pdf,.pdf"
                onChange={(event) => void handleFile(event.target.files)}
              />
            </div>
            {previewUrl ? (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-emerald-900">
                  🔍 โปรดตรวจสอบชื่อผู้รับโอน ({partyName}) และยอดเงินบนสลิปให้ตรงกับยอดจ่ายจริง (฿
                  {formatMoney(netAmount)}) ก่อนกดยืนยัน
                </p>
                {isPdf ? (
                  <iframe
                    title="ตัวอย่างสลิป"
                    src={previewUrl}
                    className="h-[420px] w-full rounded-xl border-2 border-emerald-200 shadow-md"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="ตัวอย่างสลิปใหม่"
                    className="max-h-[420px] w-auto rounded-xl border-2 border-emerald-200 object-contain shadow-md"
                  />
                )}
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setZoom(true)}>
                    🔍 คลิกเพื่อขยายดูสลิปเต็มจอ
                  </Button>
                  <Button type="button" variant="outline" onClick={() => setFile(null)}>
                    🗑️ เปลี่ยนไฟล์สลิป
                  </Button>
                </div>
              </div>
            ) : null}
            <div className="flex justify-end">
              <Button type="button" onClick={() => void save()} disabled={saving || !file}>
                {saving ? "กำลังบันทึก..." : "บันทึกสลิปใหม่"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={zoom} onOpenChange={setZoom}>
        <DialogContent className="max-h-[95vh] max-w-5xl overflow-auto bg-slate-950 p-3">
          {previewUrl && isPdf ? (
            <iframe title="สลิปเต็มจอ" src={previewUrl} className="h-[85vh] w-full rounded-lg bg-white" />
          ) : previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="สลิปเต็มจอ" className="mx-auto max-h-[85vh] w-auto object-contain" />
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
