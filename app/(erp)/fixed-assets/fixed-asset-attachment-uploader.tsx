"use client";

/**
 * Fixed-asset attachment uploader — Server Action only (document_attachments).
 */

import { useRef, useTransition } from "react";
import { FileUp, Loader2, Paperclip, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { uploadFixedAssetAttachment } from "@/app/actions/fixed-assets";
import { Button } from "@/components/ui/button";

export type FixedAssetAttachmentUploaderProps = {
  urls: string[];
  disabled?: boolean;
  onChange: (urls: string[]) => void;
};

function fileLabelFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const name = path.split("/").pop() ?? url;
    return decodeURIComponent(name);
  } catch {
    return url.slice(0, 48);
  }
}

export function FixedAssetAttachmentUploader({
  urls,
  disabled = false,
  onChange,
}: FixedAssetAttachmentUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isUploading, startUpload] = useTransition();

  function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0 || isUploading || disabled) return;
    const files = Array.from(fileList);
    if (inputRef.current) inputRef.current.value = "";

    startUpload(async () => {
      const next = [...urls];
      for (const file of files) {
        if (next.length >= 10) {
          toast.error("แนบไฟล์ได้สูงสุด 10 ไฟล์");
          break;
        }
        const formData = new FormData();
        formData.set("file", file);
        const result = await uploadFixedAssetAttachment(formData);
        if (!result.success || !result.url) {
          toast.error(result.error ?? `อัปโหลด ${file.name} ไม่สำเร็จ`);
          continue;
        }
        next.push(result.url);
        toast.success(`อัปโหลด ${file.name} แล้ว`);
      }
      onChange(next);
    });
  }

  return (
    <div className="space-y-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,application/pdf"
        multiple
        className="hidden"
        disabled={disabled || isUploading}
        onChange={(event) => handleFiles(event.target.files)}
      />
      <Button
        type="button"
        variant="outline"
        className="w-full gap-2"
        disabled={disabled || isUploading}
        onClick={() => inputRef.current?.click()}
      >
        {isUploading ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileUp className="size-4" />
        )}
        {isUploading ? "กำลังอัปโหลด..." : "อัปโหลดไฟล์แนบ (ใบรับประกัน / เอกสาร)"}
      </Button>
      <p className="text-xs text-slate-500">
        เก็บใน Storage bucket <code>document_attachments</code> · JPG/PNG/WEBP/PDF
        สูงสุด 10MB/ไฟล์
      </p>
      {urls.length > 0 ? (
        <ul className="space-y-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
          {urls.map((url) => (
            <li
              key={url}
              className="flex items-center gap-2 text-sm text-slate-700"
            >
              <Paperclip className="size-3.5 shrink-0 text-slate-400" />
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="min-w-0 flex-1 truncate text-blue-700 underline-offset-2 hover:underline"
              >
                {fileLabelFromUrl(url)}
              </a>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 shrink-0 text-red-600 hover:text-red-700"
                disabled={disabled || isUploading}
                onClick={() => onChange(urls.filter((item) => item !== url))}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
