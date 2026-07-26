"use client";

import { useCallback, useRef, useState, type DragEvent } from "react";
import { FileImage, UploadCloud, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const ACCEPT =
  "image/jpeg,image/png,image/webp,image/jpg,application/pdf";

export type InvoiceDropzoneProps = {
  disabled?: boolean;
  isProcessing?: boolean;
  fileName?: string;
  previewUrl?: string | null;
  onFileSelected: (file: File) => void;
  onClear?: () => void;
  className?: string;
};

function isAcceptedFile(file: File): boolean {
  return (
    file.type.startsWith("image/") || file.type === "application/pdf"
  );
}

/**
 * Drag-and-drop + click upload zone for invoice / bill images.
 */
export function InvoiceDropzone({
  disabled = false,
  isProcessing = false,
  fileName,
  previewUrl,
  onFileSelected,
  onClear,
  className,
}: InvoiceDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [localError, setLocalError] = useState("");

  const pickFile = useCallback(
    (file: File | undefined | null) => {
      setLocalError("");
      if (!file) return;
      if (!isAcceptedFile(file)) {
        setLocalError("รองรับเฉพาะ JPEG, PNG, WebP หรือ PDF");
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected],
  );

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (disabled || isProcessing) return;
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (disabled || isProcessing) return;
    const file = event.dataTransfer.files?.[0];
    pickFile(file);
  }

  return (
    <div className={cn("space-y-3", className)}>
      <div
        role="button"
        tabIndex={disabled || isProcessing ? -1 : 0}
        aria-disabled={disabled || isProcessing}
        aria-label="ลากวางหรือคลิกเพื่ออัปโหลดรูปบิล"
        onKeyDown={(event) => {
          if (disabled || isProcessing) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onClick={() => {
          if (disabled || isProcessing) return;
          inputRef.current?.click();
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "relative flex min-h-[180px] cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-8 text-center transition",
          isDragging &&
            !disabled &&
            "border-blue-500 bg-blue-50/80 ring-2 ring-blue-200",
          !isDragging &&
            !disabled &&
            "border-slate-300 bg-slate-50/70 hover:border-blue-400 hover:bg-blue-50/40",
          (disabled || isProcessing) &&
            "cursor-not-allowed border-slate-200 bg-slate-100/80 opacity-70",
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          className="sr-only"
          disabled={disabled || isProcessing}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            pickFile(file);
          }}
        />

        <div
          className={cn(
            "grid size-12 place-items-center rounded-2xl",
            isDragging ? "bg-blue-100 text-blue-700" : "bg-white text-slate-500 shadow-sm",
          )}
        >
          {isProcessing ? (
            <span className="size-6 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
          ) : (
            <UploadCloud className="size-6" aria-hidden />
          )}
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-800">
            {isProcessing
              ? "กำลังอัปโหลดและอ่านบิลด้วย AI…"
              : isDragging
                ? "วางไฟล์ที่นี่"
                : "ลากวางรูปบิล หรือคลิกเพื่อเลือกไฟล์"}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">
            JPEG / PNG / WebP / PDF · สูงสุด 8MB · จะถูกแปลงเป็น Base64 ก่อนส่ง OCR
          </p>
        </div>

        {!disabled && !isProcessing ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="pointer-events-none"
          >
            <FileImage className="size-3.5" aria-hidden />
            เลือกไฟล์บิล
          </Button>
        ) : null}
      </div>

      {localError ? (
        <p role="alert" className="text-xs font-medium text-red-600">
          {localError}
        </p>
      ) : null}

      {(fileName || previewUrl) && (
        <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="ตัวอย่างบิล"
              className="size-16 shrink-0 rounded-lg border border-slate-100 object-cover"
            />
          ) : (
            <div className="grid size-16 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-400">
              <FileImage className="size-6" aria-hidden />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">
              {fileName || "invoice"}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-400">
              พร้อมส่งไป process-receipt-ocr
            </p>
          </div>
          {onClear && !isProcessing ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClear();
              }}
              aria-label="ล้างไฟล์บิล"
              className="grid size-8 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="size-4" aria-hidden />
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}
