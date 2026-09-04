"use client";

/**
 * Phase 17 — SO line-item Mockup upload + Send to Production.
 * Zero Client-Side Fetching: Server Actions only.
 */

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Factory,
  ImagePlus,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  sendToProduction,
  uploadDocumentItemMockup,
} from "@/lib/actions/production/send-to-production-action";
import { compressImage } from "@/lib/utils/image-compression";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type SoLineItemProductionActionsProps = {
  documentItemId: string;
  docNo: string;
  /** SO must be ISSUED to send */
  canSend: boolean;
  isService: boolean;
  isManufactured: boolean;
  isSentToProduction: boolean;
  mockupImageUrl: string | null;
  productionJobNo?: string | null;
  className?: string;
};

export function SoLineItemProductionActions({
  documentItemId,
  docNo,
  canSend,
  isService,
  isManufactured,
  isSentToProduction,
  mockupImageUrl,
  productionJobNo = null,
  className,
}: SoLineItemProductionActionsProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isSending, startSend] = useTransition();
  const [isUploading, startUpload] = useTransition();
  const [localMockup, setLocalMockup] = useState(mockupImageUrl);
  const [localSent, setLocalSent] = useState(isSentToProduction);

  useEffect(() => {
    setLocalMockup(mockupImageUrl);
  }, [mockupImageUrl]);

  useEffect(() => {
    setLocalSent(isSentToProduction);
  }, [isSentToProduction]);

  if (!isService && !isManufactured) {
    return null;
  }

  const isBusy = isSending || isUploading;
  const mockup = localMockup?.trim() || null;
  const sent = localSent;

  function handleUploadClick() {
    if (sent || isBusy) return;
    fileInputRef.current?.click();
  }

  function handleFileChange(file: File | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("กรุณาเลือกไฟล์รูปภาพ (JPG/PNG/WEBP)");
      return;
    }

    startUpload(async () => {
      try {
        const compressed = await compressImage(file);
        const formData = new FormData();
        formData.set("document_item_id", documentItemId);
        formData.set("file", compressed);

        const result = await uploadDocumentItemMockup(formData);
        if (!result.success || !result.data) {
          toast.error(result.error ?? "อัปโหลด Mockup ไม่สำเร็จ");
          return;
        }

        setLocalMockup(result.data.mockup_image_url);
        toast.success("อัปโหลด Mockup สำเร็จ");
        router.refresh();
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "บีบอัด/อัปโหลดรูปไม่สำเร็จ",
        );
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  function handleSend() {
    if (!canSend || sent || isBusy) return;

    startSend(async () => {
      const result = await sendToProduction(documentItemId);
      if (!result.success) {
        toast.error(result.error ?? "ส่งงานผลิตไม่สำเร็จ");
        return;
      }

      setLocalSent(true);
      const jobNo = result.data?.job_no;
      toast.success(
        jobNo ? `ส่งงานผลิตสำเร็จ (${jobNo})` : "ส่งงานผลิตสำเร็จ",
      );
      router.refresh();
    });
  }

  return (
    <div className={cn("mt-2 flex flex-col gap-2", className)}>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        disabled={isBusy || sent}
        onChange={(event) => handleFileChange(event.target.files?.[0])}
      />

      <div className="flex flex-wrap items-center gap-2">
        {mockup ? (
          <a
            href={mockup}
            target="_blank"
            rel="noreferrer"
            className="block overflow-hidden rounded-lg border border-slate-200"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mockup}
              alt="Mockup"
              className="h-12 w-12 object-cover"
            />
          </a>
        ) : null}

        {!sent ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isBusy}
            onClick={handleUploadClick}
            className="h-8 gap-1.5 text-xs"
          >
            {isUploading ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <ImagePlus className="size-3.5" />
            )}
            {mockup ? "เปลี่ยน Mockup" : "Upload Mockup"}
          </Button>
        ) : null}

        {sent ? (
          <Badge className="border-emerald-200 bg-emerald-50 text-[10px] font-semibold text-emerald-800 hover:bg-emerald-50">
            <CheckCircle2 className="mr-1 size-3" />
            Sent to Production
            {productionJobNo ? ` · ${productionJobNo}` : ""}
          </Badge>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={!canSend || isBusy}
            onClick={handleSend}
            className="h-8 gap-1.5 bg-blue-600 text-xs hover:bg-blue-700"
            title={
              !canSend
                ? "ยืนยันใบสั่งขาย (ISSUED) ก่อนส่งงานผลิต"
                : DOCUMENT_ACTIONS.SEND_TO_PRODUCTION
            }
          >
            {isSending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Factory className="size-3.5" />
            )}
            {isSending ? "กำลังส่ง..." : "Send to Production"}
          </Button>
        )}
      </div>

      {!canSend && !sent ? (
        <p className="text-[10px] text-amber-700">
          ยืนยันเอกสาร SO เป็น ISSUED ก่อนส่งงานผลิต
        </p>
      ) : null}

      <span className="sr-only">
        {docNo} · {documentItemId}
      </span>
    </div>
  );
}

export default SoLineItemProductionActions;
