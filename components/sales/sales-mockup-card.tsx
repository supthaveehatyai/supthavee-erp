"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { updateSalesDocumentMockup } from "@/lib/actions/document-actions";
import { uploadSalesOrderMockup } from "@/lib/actions/sales-order-actions";
import { compressImage } from "@/lib/utils/image-compression";
import { Button } from "@/components/ui/button";

export function SalesMockupCard({
  url,
  disabled = false,
  documentId = null,
  onChange,
}: {
  url: string;
  disabled?: boolean;
  /** เมื่อมีรหัสเอกสาร จะบันทึก URL ทันที รวมบิล ISSUED */
  documentId?: string | null;
  onChange?: (nextUrl: string) => void;
}) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, startUpload] = useTransition();
  const [localUrl, setLocalUrl] = useState(url);
  const preview = (onChange ? url : localUrl).trim();

  useEffect(() => {
    setLocalUrl(url);
  }, [url]);

  function handleFile(file: File | undefined) {
    if (!file || disabled || isUploading) return;
    if (!file.type.startsWith("image/")) {
      toast.error("กรุณาเลือกไฟล์รูปภาพ (JPG/PNG/WEBP)");
      return;
    }

    startUpload(async () => {
      try {
        const compressed = await compressImage(file);
        const formData = new FormData();
        formData.set("file", compressed);
        if (documentId) formData.set("document_id", documentId);

        const uploaded = await uploadSalesOrderMockup(formData);
        if (!uploaded.success || !uploaded.data) {
          toast.error(uploaded.error ?? "อัปโหลด Mockup ไม่สำเร็จ");
          return;
        }

        if (documentId) {
          const saved = await updateSalesDocumentMockup(documentId, uploaded.data.url);
          if (saved.error) {
            toast.error(saved.error);
            return;
          }
          router.refresh();
        }

        setLocalUrl(uploaded.data.url);
        onChange?.(uploaded.data.url);
        toast.success("อัปโหลด Mockup (WebP) สำเร็จ");
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "บีบอัด/อัปโหลดรูปไม่สำเร็จ");
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    });
  }

  return (
    <section className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">
            🎨 รูปแบบงานสกรีน / ปัก / ผลิต (Mockup สำหรับส่งช่างใน Kanban)
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            บีบอัดเป็น WebP แล้วเก็บใน production_attachments — ใช้รูปนี้บนใบงานในกระดานผลิต
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => handleFile(event.target.files?.[0])}
        />
        <Button
          type="button"
          variant="outline"
          disabled={disabled || isUploading}
          onClick={() => fileInputRef.current?.click()}
          className="h-9"
        >
          {isUploading ? (
            <Loader2 className="mr-1.5 size-4 animate-spin" />
          ) : (
            <ImagePlus className="mr-1.5 size-4" />
          )}
          {preview ? "เปลี่ยนรูป Mockup" : "อัปโหลดรูป Mockup"}
        </Button>
      </div>
      {preview ? (
        <div className="relative mt-3 inline-block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={preview}
            alt="Mockup งานสกรีน ปัก หรือผลิต"
            className="max-h-48 rounded-lg border border-slate-200 bg-white object-contain"
          />
          {!documentId && onChange ? (
            <button
              type="button"
              disabled={disabled || isUploading}
              onClick={() => onChange("")}
              className="absolute right-1 top-1 rounded-md bg-white/90 p-1 text-slate-500 shadow hover:text-slate-800"
              aria-label="เอา Mockup ออก"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
