"use client";

/**
 * Reference document uploads for REC (WHT cert) / PAY (original receipt).
 * Persist via Server Action `uploadDocumentAttachment` + FormData.
 */

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  uploadDocumentAttachment,
  type DocumentAttachmentKind,
} from "@/lib/actions/finance/attachments";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ExternalLink, FileUp } from "lucide-react";

export type ReferenceDocumentsSectionProps = {
  documentId: string;
  mode: "REC" | "PAY";
  /** Show WHT upload slot when true (REC + WHT > 0). */
  showWhtUpload?: boolean;
  whtAttachmentUrl?: string | null;
  originalReceiptUrl?: string | null;
};

type SlotConfig = {
  kind: DocumentAttachmentKind;
  title: string;
  description: string;
  existingUrl: string | null;
  accentClass: string;
  buttonClass: string;
};

export function ReferenceDocumentsSection({
  documentId,
  mode,
  showWhtUpload = false,
  whtAttachmentUrl = null,
  originalReceiptUrl = null,
}: ReferenceDocumentsSectionProps) {
  const slots: SlotConfig[] = [];

  if (mode === "REC" && showWhtUpload) {
    slots.push({
      kind: "wht_certificate",
      title: "สแกนใบหัก ณ ที่จ่าย (WHT Certificate)",
      description: "แนบหนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) — รูปภาพหรือ PDF",
      existingUrl: whtAttachmentUrl?.trim() || null,
      accentClass: "border-blue-200",
      buttonClass:
        "border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100",
    });
  }

  if (mode === "PAY") {
    slots.push({
      kind: "original_receipt",
      title: "สแกนใบเสร็จตัวจริง/ใบกำกับภาษี (Original Receipt)",
      description: "แนบสำเนาใบเสร็จหรือใบกำกับภาษีจากผู้จำหน่าย — รูปภาพหรือ PDF",
      existingUrl: originalReceiptUrl?.trim() || null,
      accentClass: "border-orange-200",
      buttonClass:
        "border-orange-200 bg-orange-50 text-orange-800 hover:bg-orange-100",
    });
  }

  if (slots.length === 0) return null;

  return (
    <Card className="border-slate-200 shadow-sm print:hidden">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          เอกสารอ้างอิง (Reference Documents)
        </CardTitle>
        <CardDescription>
          แนบเอกสารประกอบทางบัญชี — เก็บใน Storage และผูกกับเอกสาร{" "}
          {mode}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {slots.map((slot) => (
          <ReferenceUploadSlot
            key={slot.kind}
            documentId={documentId}
            slot={slot}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function ReferenceUploadSlot({
  documentId,
  slot,
}: {
  documentId: string;
  slot: SlotConfig;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(fileList: FileList | null) {
    const file = fileList?.[0] ?? null;
    if (!file) {
      setSelectedName(null);
      return;
    }
    const mime = (file.type || "").toLowerCase();
    const allowed =
      mime.startsWith("image/") || mime === "application/pdf" || !mime;
    if (!allowed) {
      toast.error("แนบได้เฉพาะไฟล์รูปภาพ หรือ PDF");
      if (fileRef.current) fileRef.current.value = "";
      setSelectedName(null);
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("ไฟล์ใหญ่เกิน 10MB");
      if (fileRef.current) fileRef.current.value = "";
      setSelectedName(null);
      return;
    }
    setSelectedName(file.name);
  }

  function handleSubmit(formData: FormData) {
    const file = formData.get("file");
    if (!(file instanceof File) || file.size <= 0) {
      toast.error("กรุณาเลือกไฟล์ก่อนอัปโหลด");
      return;
    }

    startTransition(async () => {
      const result = await uploadDocumentAttachment(formData);
      if (!result.success) {
        toast.error(result.error ?? "อัปโหลดไม่สำเร็จ");
        return;
      }
      toast.success(`อัปโหลด${slot.title.split("(")[0]?.trim() ?? "ไฟล์"}สำเร็จ`);
      setSelectedName(null);
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div
      className={`space-y-3 rounded-lg border bg-white p-4 ${slot.accentClass}`}
    >
      <div>
        <h4 className="text-sm font-semibold text-slate-900">{slot.title}</h4>
        <p className="mt-0.5 text-xs text-slate-500">{slot.description}</p>
      </div>

      {slot.existingUrl ? (
        <a
          href={slot.existingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition sm:w-auto sm:px-4 ${slot.buttonClass}`}
        >
          <ExternalLink className="size-4" />
          เปิดดูไฟล์
        </a>
      ) : null}

      <form action={handleSubmit} className="space-y-3">
        <input type="hidden" name="document_id" value={documentId} />
        <input type="hidden" name="kind" value={slot.kind} />

        <div className="space-y-2">
          <Label htmlFor={`ref-file-${slot.kind}`}>
            {slot.existingUrl ? "อัปโหลดไฟล์ใหม่แทนที่" : "เลือกไฟล์อัปโหลด"}
          </Label>
          <div className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3 text-sm text-slate-600">
              <FileUp className="mt-0.5 h-5 w-5 shrink-0 text-slate-500" />
              <div>
                <p className="font-medium text-slate-800">
                  แนบไฟล์รูปภาพ หรือ PDF (สูงสุด 10MB)
                </p>
                <p className="text-xs text-slate-500">
                  {selectedName
                    ? `เลือกแล้ว: ${selectedName}`
                    : "ยังไม่ได้เลือกไฟล์"}
                </p>
              </div>
            </div>
            <Input
              ref={fileRef}
              id={`ref-file-${slot.kind}`}
              name="file"
              type="file"
              accept="image/*,application/pdf,.pdf"
              className="max-w-xs cursor-pointer bg-white"
              onChange={(e) => handleFileChange(e.target.files)}
            />
          </div>
        </div>

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending || !selectedName}>
            {isPending ? "กำลังอัปโหลด..." : "อัปโหลดไฟล์"}
          </Button>
        </div>
      </form>
    </div>
  );
}
