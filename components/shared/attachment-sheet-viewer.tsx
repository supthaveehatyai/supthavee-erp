"use client";

/**
 * Slide-over attachment viewer (payment slips / file previews).
 * Opens from the right via shadcn Sheet — no new browser tab.
 * Phase 14: NAS offline path when storage_tier = NAS.
 */

import { useState, type ReactNode } from "react";
import { FileText, HardDrive, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { TieredStorageImage } from "@/components/shared/tiered-storage-image";
import type { StorageTier } from "@/types/storage-tier";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

export type AttachmentSheetViewerProps = {
  fileUrl: string;
  title: string;
  trigger: ReactNode;
  /** Phase 14 — badge / offline NAS handling */
  storageTier?: StorageTier | null;
  /** Raw NAS path label when tier = NAS and fileUrl is not browsable */
  nasPath?: string | null;
};

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

function isProbablyPdfUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  return path.endsWith(".pdf") || path.includes("application/pdf");
}

function isProbablyImageUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (isProbablyPdfUrl(url)) return false;
  if (/\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(path)) return true;
  return (
    path.includes("/slip-") ||
    path.includes("/exp-") ||
    path.includes("payment") ||
    path.includes("expense_documents") ||
    path.includes("production_attachments") ||
    path.includes("ar_payment") ||
    path.includes("ap_payment")
  );
}

export function AttachmentSheetViewer({
  fileUrl,
  title,
  trigger,
  storageTier = "CLOUD",
  nasPath = null,
}: AttachmentSheetViewerProps) {
  const [open, setOpen] = useState(false);
  const [zoom, setZoom] = useState(1);

  const url = fileUrl?.trim() ?? "";
  const tier = storageTier === "NAS" ? "NAS" : "CLOUD";
  if (!url && tier !== "NAS") return null;

  const showImage = Boolean(url) && isProbablyImageUrl(url);
  const showPdf = Boolean(url) && !showImage && isProbablyPdfUrl(url);
  const showNasOffline = tier === "NAS" && !url;

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) setZoom(1);
  }

  function bumpZoom(delta: number) {
    setZoom((prev) =>
      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round((prev + delta) * 100) / 100)),
    );
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>{trigger}</SheetTrigger>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-xl md:max-w-2xl"
      >
        <SheetHeader className="shrink-0">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>
            {showNasOffline
              ? "ไฟล์ถูกเก็บถาวรบน NAS — เปิดจากเครื่องสาขา"
              : showImage
                ? "ย่อพอดีจออัตโนมัติ · ซูมขยายได้ถ้าต้องการ"
                : showPdf
                  ? "แสดงไฟล์ PDF ในแผงด้านข้าง"
                  : "ดูไฟล์แนบในแผงด้านข้าง"}
          </SheetDescription>
        </SheetHeader>

        {showImage ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-100 px-6 py-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => bumpZoom(-ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              aria-label="ย่อภาพ"
            >
              <ZoomOut className="size-3.5" />
              ย่อ
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => bumpZoom(ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              aria-label="ขยายภาพ"
            >
              <ZoomIn className="size-3.5" />
              ขยาย
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setZoom(1)}
              disabled={zoom === 1}
              aria-label="รีเซ็ตซูม"
            >
              <RotateCcw className="size-3.5" />
              {Math.round(zoom * 100)}%
            </Button>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden px-4 pb-4">
          {showNasOffline ? (
            <div className="mt-4 flex h-[calc(100vh-120px)] flex-col items-center justify-center gap-3 rounded-md border border-amber-200 bg-amber-50 p-8 text-center">
              <HardDrive className="size-10 text-amber-700" />
              <p className="text-sm font-semibold text-amber-900">
                สลิปถูกเก็บถาวรบน NAS
              </p>
              {nasPath ? (
                <p className="max-w-full break-all text-xs text-amber-800/80">
                  {nasPath}
                </p>
              ) : null}
            </div>
          ) : showImage ? (
            <div className="relative mt-4 flex h-[calc(100vh-120px)] w-full items-center justify-center overflow-hidden rounded-md border border-slate-100 bg-slate-50/50 p-2">
              <div
                className="relative h-full w-full"
                style={
                  zoom === 1
                    ? undefined
                    : {
                        transform: `scale(${zoom})`,
                        transformOrigin: "center center",
                      }
                }
              >
                <TieredStorageImage
                  src={url}
                  alt={title}
                  storageTier={tier}
                  nasPath={nasPath}
                  fill
                  sizes="(max-width: 768px) 100vw, 640px"
                  objectFit="contain"
                  showTierBadge={tier === "NAS"}
                />
              </div>
            </div>
          ) : showPdf ? (
            <iframe
              src={url}
              title={title}
              className="mt-4 h-[calc(100vh-120px)] w-full rounded-md border border-slate-100 bg-white"
            />
          ) : (
            <div className="mt-4 flex h-[calc(100vh-120px)] flex-col items-center justify-center gap-4 rounded-md border border-slate-100 bg-slate-50/50 p-8 text-center">
              <div className="grid size-14 place-items-center rounded-2xl bg-white text-slate-500 shadow-sm">
                <FileText className="size-7" />
              </div>
              <p className="text-sm text-slate-600">
                ไม่สามารถแสดงตัวอย่างไฟล์นี้ในแผงด้านข้างได้
              </p>
              {url ? (
                <a
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm font-semibold text-blue-700 underline-offset-2 hover:underline"
                >
                  เปิดไฟล์ต้นฉบับ
                </a>
              ) : null}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
