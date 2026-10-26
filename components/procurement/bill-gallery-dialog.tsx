"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { FileImage, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { saveDocumentProcurementBills } from "@/lib/actions/procurement-bills";
import { uploadProcurementBills } from "@/lib/procurement/upload-bill-files";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { BillAttachmentPicker } from "@/components/procurement/bill-attachment-picker";

function isPdf(url: string): boolean {
  return /\.pdf($|\?)/i.test(url);
}

export function BillGalleryButton({
  urls,
  label,
  className,
}: {
  urls: string[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  if (urls.length === 0) return null;
  const current = urls[Math.min(index, urls.length - 1)] ?? urls[0];

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setIndex(0);
          setOpen(true);
        }}
        className={cn(
          "inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50",
          className,
        )}
      >
        {label ? null : <ImageIcon className="size-3.5" />}
        {label ?? `ดูรูปบิล (${urls.length.toLocaleString("th-TH")} หน้า)`}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-4xl flex-col overflow-hidden p-4">
          <DialogHeader className="mb-2">
            <DialogTitle>รูปบิลอ้างอิง</DialogTitle>
            <DialogDescription>
              หน้า {(index + 1).toLocaleString("th-TH")} / {urls.length.toLocaleString("th-TH")}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-slate-50 p-2">
            {isPdf(current) ? (
              <iframe title={`บิลหน้า ${index + 1}`} src={current} className="h-[68vh] w-full rounded-lg bg-white" />
            ) : (
              <img src={current} alt={`บิลหน้า ${index + 1}`} className="max-h-[68vh] w-full object-contain" />
            )}
          </div>
          {urls.length > 1 ? (
            <div className="mt-3 flex items-center justify-between gap-2">
              <Button type="button" variant="outline" disabled={index === 0} onClick={() => setIndex((value) => value - 1)}>
                ก่อนหน้า
              </Button>
              <div className="flex gap-1 overflow-x-auto">
                {urls.map((url, itemIndex) => (
                  <button
                    key={`${url}-${itemIndex}`}
                    type="button"
                    onClick={() => setIndex(itemIndex)}
                    className={`grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg border ${
                      itemIndex === index ? "border-blue-500" : "border-slate-200"
                    }`}
                  >
                    {isPdf(url) ? (
                      <FileImage className="size-4 text-slate-400" />
                    ) : (
                      <img src={url} alt="" className="size-full object-cover" />
                    )}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                disabled={index >= urls.length - 1}
                onClick={() => setIndex((value) => value + 1)}
              >
                ถัดไป
              </Button>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

export function BillAttachmentAppender({
  documentId,
  docHeaderId,
  vendorRef,
}: {
  documentId: string;
  docHeaderId?: string | null;
  vendorRef: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);

  async function save() {
    if (files.length === 0 || pending) return;
    setPending(true);
    try {
      const uploaded = await uploadProcurementBills(files, vendorRef);
      if (uploaded.error || !uploaded.data) {
        toast.error(uploaded.error ?? "อัปโหลดรูปบิลไม่สำเร็จ");
        return;
      }
      const saved = await saveDocumentProcurementBills({
        documentId,
        docHeaderId,
        bills: uploaded.data,
      });
      if (!saved.success) {
        toast.error(saved.error ?? "บันทึกรูปบิลไม่สำเร็จ");
        return;
      }
      toast.success(`เพิ่มรูปบิล ${uploaded.data.attachment_urls.length.toLocaleString("th-TH")} หน้าแล้ว`);
      setFiles([]);
      setOpen(false);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
      >
        <ImageIcon className="size-3.5" />
        เพิ่มรูปบิล
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>เพิ่มรูปบิลย้อนหลัง</DialogTitle>
            <DialogDescription>
              ไฟล์จะถูกอัปโหลดขึ้น procurement_bills แล้วผูกกับเอกสารนี้
            </DialogDescription>
          </DialogHeader>
          <BillAttachmentPicker files={files} onChange={setFiles} disabled={pending} />
          <Button type="button" className="w-full" disabled={pending || files.length === 0} onClick={() => void save()}>
            {pending ? "กำลังอัปโหลด…" : "บันทึกรูปบิล"}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
