"use client";

import { useRef, useState, type DragEvent } from "react";
import { Camera, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { scanHandwrittenSalesBill } from "@/lib/actions/sales-ocr-actions";
import { cn } from "@/lib/utils";
import type { HandwrittenBillScan } from "@/types/sales-ocr";

const ACCEPT = ".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf";

type HandwrittenBillDropzoneProps = {
  disabled?: boolean;
  onScanned: (scan: HandwrittenBillScan) => void;
};

export default function HandwrittenBillDropzone({
  disabled = false,
  onScanned,
}: HandwrittenBillDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isScanning, setIsScanning] = useState(false);

  function allowDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleDragEnter(event: DragEvent<HTMLElement>) {
    allowDrop(event);
    dragDepth.current += 1;
    setIsDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>) {
    allowDrop(event);
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setIsDragging(false);
  }

  async function scanFile(file: File | null | undefined) {
    if (!file || file.size <= 0) {
      toast.error("กรุณาเลือกไฟล์บิลเขียนมือ");
      return;
    }
    setIsScanning(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await scanHandwrittenSalesBill(formData);
      if (result.error || !result.data) {
        toast.error(result.error ?? "สแกนบิลเขียนมือไม่สำเร็จ");
        return;
      }
      onScanned(result.data);
      const warningCount = result.data.warnings.length;
      toast.success(
        warningCount > 0
          ? `อ่านบิลแล้ว ${result.data.items.length} รายการ — มี ${warningCount} จุดให้ตรวจ`
          : `อ่านบิลแล้ว ${result.data.items.length} รายการ`,
      );
      for (const warning of result.data.warnings) toast.warning(warning);
    } finally {
      setIsScanning(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function handleDrop(event: DragEvent<HTMLElement>) {
    allowDrop(event);
    dragDepth.current = 0;
    setIsDragging(false);
    if (disabled || isScanning) return;
    await scanFile(event.dataTransfer.files?.[0]);
  }

  return (
    <label
      htmlFor="handwritten-bill-ocr"
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-5 text-center transition",
        isDragging
          ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200"
          : "border-slate-300 bg-white hover:border-blue-400 hover:bg-blue-50/40",
        (disabled || isScanning) && "pointer-events-none opacity-70",
      )}
      onDragEnter={handleDragEnter}
      onDragOver={allowDrop}
      onDragLeave={handleDragLeave}
      onDrop={(event) => {
        void handleDrop(event);
      }}
    >
      <input
        ref={inputRef}
        id="handwritten-bill-ocr"
        type="file"
        accept={ACCEPT}
        className="sr-only"
        disabled={disabled || isScanning}
        onChange={(event) => {
          void scanFile(event.target.files?.[0]);
        }}
      />
      <span className="grid size-11 place-items-center rounded-2xl bg-blue-50 text-blue-700">
        {isScanning ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
      </span>
      <span className="text-sm font-semibold text-slate-900">
        📷 สแกนบิลเขียนมือด้วย AI (OCR)
      </span>
      <span className="text-xs text-slate-500">
        ลากไฟล์มาวาง หรือคลิกเพื่อเลือก JPG, PNG, WEBP, PDF
      </span>
    </label>
  );
}
