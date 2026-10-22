"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { FileImage, UploadCloud, X } from "lucide-react";
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
}: {
  files: File[];
  onChange: (files: File[]) => void;
  disabled?: boolean;
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
    <div className="space-y-3">
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
          "flex min-h-[148px] cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-6 py-6 text-center",
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
        <div className="grid size-11 place-items-center rounded-2xl bg-white text-slate-500 shadow-sm">
          <UploadCloud className="size-5" />
        </div>
        <p className="text-sm font-semibold text-slate-800">
          อัปโหลดรูปบิล / เอกสารอ้างอิง (Drag & Drop)
        </p>
        <p className="text-[11px] text-slate-400">
          JPEG, PNG, WebP หรือ PDF ได้หลายหน้า
        </p>
      </div>
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
      {previews.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {previews.map((item, index) => (
            <div key={item.key} className="relative rounded-xl border border-slate-200 bg-white p-2">
              <button
                type="button"
                className="block w-full"
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
                    className="h-28 w-full rounded-lg object-cover"
                  />
                ) : (
                  <div className="grid h-28 place-items-center rounded-lg bg-slate-100 text-slate-400">
                    <FileImage className="size-6" />
                    <span className="text-[11px]">PDF</span>
                  </div>
                )}
              </button>
              <p className="mt-1 truncate text-[11px] text-slate-600">{item.file.name}</p>
              <button
                type="button"
                aria-label="ลบรูปบิล"
                disabled={disabled}
                onClick={() => removeAt(index)}
                className="absolute right-3 top-3 grid size-7 place-items-center rounded-lg bg-white/90 text-slate-500 shadow-sm hover:text-red-600"
              >
                <X className="size-3.5" />
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
