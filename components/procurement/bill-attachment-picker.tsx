"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { FileImage, UploadCloud, X, ZoomIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const ACCEPT = "image/jpeg,image/png,image/webp,application/pdf";

type PreviewFile = {
  key: string;
  file: File;
  previewUrl: string | null;
};

function accepted(file: File): boolean {
  return (
    file.type === "application/pdf" ||
    file.type === "image/jpeg" ||
    file.type === "image/png" ||
    file.type === "image/webp" ||
    /\.(jpe?g|png|webp|pdf)$/i.test(file.name)
  );
}

export function BillAttachmentPicker({
  files,
  onChange,
  disabled = false,
  compact = false,
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState("");
  const [lightbox, setLightbox] = useState<PreviewFile | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const previews = useMemo<PreviewFile[]>(
    () =>
      files.map((file, index) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
      })),
    [files],
  );

  useEffect(() => {
    return () => {
      for (const item of previews) {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
    };
  }, [previews]);

  function addFiles(list: FileList | File[] | null | undefined) {
    const next = Array.from(list ?? []).filter(accepted);
    if ((list?.length ?? 0) > 0 && next.length === 0) {
      setError("รองรับเฉพาะ JPEG, PNG, WebP หรือ PDF");
      return;
    }
    setError("");
    if (next.length === 0) return;
    onChange([...files, ...next]);
  }

  function removeAt(index: number) {
    onChange(files.filter((_, itemIndex) => itemIndex !== index));
  }

  function onDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    addFiles(event.dataTransfer.files);
  }

  return (
    <div className={compact ? "space-y-2" : "space-y-3"}>
      <div
        role="button"
        tabIndex={disabled ? -1 : 0}
        onClick={() => {
          if (!disabled) inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (disabled) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed text-center",
          compact ? "min-h-[88px] gap-1 px-3 py-2" : "min-h-[148px] gap-2 px-6 py-6",
          isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 bg-slate-50/70 hover:border-blue-400",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          disabled={disabled}
          onChange={(event) => {
            addFiles(event.target.files);
            event.target.value = "";
          }}
        />
        <div
          className={cn(
            "grid place-items-center rounded-xl bg-white text-slate-500 shadow-sm",
            compact ? "size-8" : "size-11 rounded-2xl",
          )}
        >
          <UploadCloud className={compact ? "size-4" : "size-5"} />
        </div>
        <p className={cn("font-semibold text-slate-800", compact ? "text-xs" : "text-sm")}>
          อัปโหลดรูปบิล / เอกสารอ้างอิง (Drag & Drop)
        </p>
        <p className="text-[11px] text-slate-400">
          JPEG, PNG, WebP หรือ PDF ได้หลายหน้า
        </p>
      </div>
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {previews.length > 0 ? (
        <div className={cn("grid gap-2", compact ? "grid-cols-4" : "grid-cols-2 sm:grid-cols-4")}>
          {previews.map((item, index) => (
            <div key={item.key} className="relative rounded-xl border border-slate-200 bg-white p-1.5">
              <button
                type="button"
                className="block w-full"
                aria-label="ซูมดูรูป"
                onClick={() => {
                  if (pdfUrl) URL.revokeObjectURL(pdfUrl);
                  setPdfUrl(item.previewUrl ? null : URL.createObjectURL(item.file));
                  setLightbox(item);
                }}
              >
                {item.previewUrl ? (
                  <img
                    src={item.previewUrl}
                    alt={item.file.name}
                    className={cn("w-full rounded-lg object-cover", compact ? "h-14" : "h-28")}
                  />
                ) : (
                  <div
                    className={cn(
                      "grid place-items-center rounded-lg bg-slate-100 text-slate-400",
                      compact ? "h-14" : "h-28",
                    )}
                  >
                    <FileImage className="size-4" />
                    <span className="text-[10px]">PDF</span>
                  </div>
                )}
              </button>
              <div className="mt-1 flex items-center justify-between gap-1">
                <p className="min-w-0 truncate text-[10px] text-slate-600">{item.file.name}</p>
                <button
                  type="button"
                  aria-label="ซูมดูรูป"
                  onClick={() => {
                    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
                    setPdfUrl(item.previewUrl ? null : URL.createObjectURL(item.file));
                    setLightbox(item);
                  }}
                  className="grid size-5 shrink-0 place-items-center text-slate-500 hover:text-blue-600"
                >
                  <ZoomIn className="size-3" />
                </button>
              </div>
              <button
                type="button"
                aria-label="ลบรูปบิล"
                disabled={disabled}
                onClick={() => removeAt(index)}
                className="absolute right-2 top-2 grid size-5 place-items-center rounded-md bg-white/90 text-slate-500 shadow-sm hover:text-red-600"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {lightbox ? (
        <div
          className="fixed inset-0 z-[10002] flex items-center justify-center bg-slate-900/70 p-4"
          onClick={() => setLightbox(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-4xl overflow-auto rounded-2xl bg-white p-3"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="truncate text-sm font-medium text-slate-800">{lightbox.file.name}</p>
              <Button type="button" size="sm" variant="outline" onClick={() => setLightbox(null)}>
                ปิด
              </Button>
            </div>
            {lightbox.previewUrl ? (
              <img src={lightbox.previewUrl} alt={lightbox.file.name} className="max-h-[75vh] w-full object-contain" />
            ) : pdfUrl ? (
              <iframe title={lightbox.file.name} src={pdfUrl} className="h-[75vh] w-full" />
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
