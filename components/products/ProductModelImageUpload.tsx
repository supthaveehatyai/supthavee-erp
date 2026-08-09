"use client";

import {
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import imageCompression from "browser-image-compression";
import { ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { uploadProductModelImage } from "@/app/products/actions/product-matrix";
import { cn } from "@/lib/utils";

type ProductModelImageUploadProps = {
  value: string;
  onChange: (url: string) => void;
  modelCode?: string;
  disabled?: boolean;
  className?: string;
};

const COMPRESSION_OPTIONS: Parameters<typeof imageCompression>[1] = {
  maxSizeMB: 0.5,
  maxWidthOrHeight: 1024,
  useWebWorker: true,
  fileType: "image/webp",
};

/** Rename file extension to .webp (keep basename). */
function toWebpFile(file: File): File {
  const base =
    file.name.replace(/\.[^.]+$/, "").trim() || "product-image";
  const safeBase = base.replace(/[^\w.-]+/g, "_").slice(0, 80) || "product-image";
  return new File([file], `${safeBase}.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
}

/**
 * Phase 11 Visual Verification — อัปโหลดรูปสินค้าเข้า `product_assets`
 * (บีบอัด Client-side เป็น WebP ก่อนส่ง Storage)
 */
export function ProductModelImageUpload({
  value,
  onChange,
  modelCode = "",
  disabled = false,
  className,
}: ProductModelImageUploadProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [cacheBust, setCacheBust] = useState<number | null>(null);

  const baseUrl = (value || "").split("?")[0];
  const previewSrc =
    !baseUrl
      ? ""
      : cacheBust != null
        ? `${baseUrl}?t=${cacheBust}`
        : baseUrl;

  const busy = disabled || isUploading || isCompressing;

  async function handlePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setIsCompressing(true);
    setIsUploading(false);
    try {
      let compressed: File;
      try {
        const result = await imageCompression(file, COMPRESSION_OPTIONS);
        compressed = toWebpFile(result);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `บีบอัดรูปไม่สำเร็จ: ${err.message}`
            : "บีบอัดรูปไม่สำเร็จ",
        );
        return;
      } finally {
        setIsCompressing(false);
      }

      setIsUploading(true);
      const formData = new FormData();
      formData.append("file", compressed);
      if (modelCode.trim()) {
        formData.append("modelCode", modelCode.trim());
      }

      const result = await uploadProductModelImage(formData);
      if (!result.ok || !result.url) {
        toast.error(result.error ?? "อัปโหลดรูปสินค้าไม่สำเร็จ");
        return;
      }

      onChange(result.url);
      setCacheBust(Date.now());
      toast.success("อัปโหลดรูปสินค้าสำเร็จ");
    } finally {
      setIsCompressing(false);
      setIsUploading(false);
    }
  }

  const statusLabel = isCompressing
    ? "กำลังบีบอัดรูป..."
    : isUploading
      ? "กำลังอัปโหลด..."
      : "เลือกไฟล์รูป";

  return (
    <div
      className={cn(
        "rounded-xl border border-dashed border-slate-200 bg-slate-50/80 p-4",
        className,
      )}
    >
      <span className="mb-2 block text-xs font-semibold text-slate-700">
        รูปภาพสินค้า (Visual Verification)
      </span>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-white">
          {previewSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={previewSrc}
              alt="รูปสินค้า"
              className="max-h-full max-w-full object-contain p-1"
              suppressHydrationWarning={true}
            />
          ) : (
            <ImagePlus className="size-8 text-slate-300" />
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2">
          <p className="text-[11px] text-slate-500">
            บีบอัดเป็น WebP อัตโนมัติ (≤0.5MB / 1024px) แล้วอัปโหลดเข้า Storage{" "}
            <code>product_assets</code> — ใช้ยืนยันสินค้าตอนเปิดบิล
          </p>
          <div className="flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="hidden"
              disabled={busy}
              onChange={(event) => void handlePick(event)}
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <ImagePlus className="size-3.5" />
              )}
              {statusLabel}
            </button>
            {baseUrl ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  onChange("");
                  setCacheBust(null);
                }}
                className="inline-flex h-9 items-center gap-2 rounded-xl px-3 text-xs font-semibold text-red-600 transition hover:bg-red-50 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                ลบรูป
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
