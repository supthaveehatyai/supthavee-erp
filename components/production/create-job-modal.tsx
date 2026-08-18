"use client";

/**
 * Phase 7 MTO — Create Production Job dialog (form only).
 * Trigger lives in SendToProductionButton — Zero Client-Side Fetching.
 */

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import {
  createProductionJob,
} from "@/app/actions/kanban-actions";
import { compressImages } from "@/lib/utils/image-compression";
import {
  PRODUCTION_JOB_TYPES,
  type ProductionJobType,
} from "@/types/kanban";
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
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

const JOB_TYPE_LABEL: Record<ProductionJobType, string> = {
  SCREEN: "สกรีน (SCREEN)",
  EMBROIDERY: "ปัก (EMBROIDERY)",
  SEWING: "เย็บ (SEWING)",
  OTHER: "อื่นๆ (OTHER)",
};

const ACCEPT_IMAGES = "image/jpeg,image/png,image/webp";

type PreviewItem = {
  id: string;
  name: string;
  url: string;
};

export type CreateJobModalProps = {
  documentId: string;
  documentNo?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** @deprecated use documentId */
  document_id?: string;
  /** @deprecated use documentNo */
  docNo?: string | null;
};

function SubmitJobButton({ compressing }: { compressing?: boolean }) {
  const { pending } = useFormStatus();
  const busy = pending || Boolean(compressing);
  return (
    <Button type="submit" disabled={busy}>
      {compressing
        ? "กำลังบีบอัดรูป..."
        : pending
          ? "กำลังอัปโหลดและสร้าง..."
          : "สร้างใบสั่งผลิต"}
    </Button>
  );
}

function CancelJobButton({ onCancel }: { onCancel: () => void }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending}
      onClick={onCancel}
    >
      ยกเลิก
    </Button>
  );
}

export function CreateJobModal({
  documentId,
  documentNo,
  open,
  onOpenChange,
  document_id,
  docNo,
}: CreateJobModalProps) {
  const router = useRouter();
  const resolvedDocumentId = (documentId || document_id || "").trim();
  const resolvedDocumentNo = documentNo ?? docNo ?? null;

  const [formKey, setFormKey] = useState(0);
  const [previews, setPreviews] = useState<PreviewItem[]>([]);
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [isCompressing, setIsCompressing] = useState(false);
  const previewUrlsRef = useRef<string[]>([]);

  function revokePreviews() {
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current = [];
    setPreviews([]);
    setAttachmentFiles([]);
  }

  useEffect(() => {
    if (!open) return;
    setFormKey((k) => k + 1);
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    previewUrlsRef.current = [];
    setPreviews([]);
    setAttachmentFiles([]);
    setIsCompressing(false);
  }, [open]);

  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  function handleFilesChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
    const next = files.map((file, index) => ({
      id: `${file.name}-${file.size}-${index}`,
      name: file.name,
      url: URL.createObjectURL(file),
    }));
    previewUrlsRef.current = next.map((p) => p.url);
    setPreviews(next);
    setAttachmentFiles(files);
  }

  async function formAction(formData: FormData) {
    // Rebuild attachments — compress to WebP before Storage upload (production_attachments)
    formData.delete("attachments");
    if (attachmentFiles.length > 0) {
      setIsCompressing(true);
      try {
        const compressed = await compressImages(attachmentFiles);
        for (const file of compressed) {
          formData.append("attachments", file);
        }
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `บีบอัดรูป Mockup ไม่สำเร็จ: ${err.message}`
            : "บีบอัดรูป Mockup ไม่สำเร็จ",
        );
        return;
      } finally {
        setIsCompressing(false);
      }
    }

    const result = await createProductionJob(formData);

    if (!result.success || !result.data) {
      toast.error(result.error ?? "สร้างใบสั่งผลิตไม่สำเร็จ");
      return;
    }

    const count = result.data.attachment_count ?? 0;
    toast.success(
      count > 0
        ? `สร้างใบสั่งผลิต ${result.data.job_no} แล้ว · แนบรูป ${count} ไฟล์`
        : `สร้างใบสั่งผลิต ${result.data.job_no} แล้ว`,
    );
    revokePreviews();
    onOpenChange(false);
    router.refresh();
    router.push("/production/kanban");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>สร้างใบสั่งผลิต (MTO)</DialogTitle>
          <DialogDescription>
            ส่งเอกสารขายเข้าสายการผลิต — สถานะเริ่มต้น TODO · เลขงาน
            JOB-YYMM-XXXX
            {resolvedDocumentNo ? (
              <>
                {" "}
                · อ้างอิง{" "}
                <span className="font-mono font-semibold text-slate-700">
                  {resolvedDocumentNo}
                </span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <form key={formKey} action={formAction} className="space-y-4">
          <input type="hidden" name="documentId" value={resolvedDocumentId} />

          <div className="space-y-1.5">
            <Label htmlFor="mto-job-type">ประเภทงาน</Label>
            <Select
              id="mto-job-type"
              name="jobType"
              defaultValue="SCREEN"
              required
            >
              {PRODUCTION_JOB_TYPES.map((type) => (
                <option key={type} value={type}>
                  {JOB_TYPE_LABEL[type]}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mto-due-date">วันกำหนดส่ง</Label>
            <Input
              id="mto-due-date"
              name="targetDate"
              type="date"
              required
              className="h-10"
            />
            <p className="text-[11px] text-slate-400">
              ระบุช่างและค่าแรงทีละบรรทัดงานบริการในหน้า Production Kanban
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mto-details">รายละเอียดคำสั่งทำ</Label>
            <Textarea
              id="mto-details"
              name="description"
              required
              rows={4}
              placeholder="เช่น สกรีนอกซ้าย 1 สี · ปักโลโก้หน้าอก"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="mto-attachments">
              แนบรูป Mockup / Logo{" "}
              <span className="font-normal text-slate-400">
                (JPG/PNG/WEBP · สูงสุด 8 ไฟล์)
              </span>
            </Label>
            <label
              htmlFor="mto-attachments"
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/80 px-4 py-6 text-center transition hover:border-violet-300 hover:bg-violet-50/40"
            >
              <ImagePlus className="size-6 text-violet-500" />
              <span className="text-sm font-medium text-slate-700">
                คลิกเพื่อเลือกไฟล์ หรือลากวางหลายรูป
              </span>
              <span className="text-xs text-slate-400">
                รองรับ image/jpeg, image/png, image/webp · บีบอัด WebP ≤0.5MB
                ก่อนอัปโหลด
              </span>
              <input
                id="mto-attachments"
                type="file"
                multiple
                accept={ACCEPT_IMAGES}
                className="sr-only"
                disabled={isCompressing}
                onChange={handleFilesChange}
              />
            </label>

            {previews.length > 0 ? (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {previews.map((item) => (
                  <div
                    key={item.id}
                    className="group relative overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.url}
                      alt={item.name}
                      className="aspect-square w-full object-cover"
                    />
                    <p className="truncate px-1.5 py-1 text-[10px] text-slate-500">
                      {item.name}
                    </p>
                  </div>
                ))}
              </div>
            ) : null}

            {previews.length > 0 ? (
              <button
                type="button"
                onClick={() => {
                  revokePreviews();
                  const input = document.getElementById(
                    "mto-attachments",
                  ) as HTMLInputElement | null;
                  if (input) input.value = "";
                }}
                className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-red-600"
              >
                <X className="size-3.5" />
                ล้างรูปที่เลือก
              </button>
            ) : null}
          </div>

          <DialogFooter>
            <CancelJobButton onCancel={() => onOpenChange(false)} />
            <SubmitJobButton compressing={isCompressing} />
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
