"use client";

/**
 * Read-only expense attachment preview + lightbox Dialog.
 * Used for receipt (`receipt_url`) and payment slip (`payment_slip_url`).
 */

import { useState } from "react";
import { Expand, ExternalLink, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type ExpenseAttachmentPreviewProps = {
  url: string | null | undefined;
  documentNo: string;
  /** Dialog / alt title, e.g. "ใบเสร็จ" or "สลิปโอนเงิน" */
  title: string;
  /** Empty-state copy when URL is missing */
  emptyLabel: string;
  /** Non-image file row label */
  fileLabel?: string;
  /** Full-size button label when image */
  viewFullLabel?: string;
};

function isProbablyImageUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (/\.pdf$/i.test(path)) return false;
  if (/\.(jpe?g|png|webp|gif)$/i.test(path)) return true;
  // Storage paths: EXP-* (receipt) / SLIP-* (payment slip)
  return (
    path.includes("/exp-") ||
    path.includes("/slip-") ||
    path.includes("expense_documents")
  );
}

export function ExpenseAttachmentPreview({
  url: rawUrl,
  documentNo,
  title,
  emptyLabel,
  fileLabel = "ไฟล์แนบ",
  viewFullLabel = "ขยายดูเต็มจอ",
}: ExpenseAttachmentPreviewProps) {
  const [open, setOpen] = useState(false);
  const url = rawUrl?.trim() || "";

  if (!url) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  const showImage = isProbablyImageUrl(url);

  return (
    <div className="space-y-3">
      {showImage ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group relative block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-blue-300 hover:shadow-sm"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={`${title} ${documentNo}`}
            className="max-h-64 w-full object-contain"
          />
          <span className="absolute bottom-2 right-2 inline-flex items-center gap-1 rounded-lg bg-white/95 px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm opacity-90 group-hover:opacity-100">
            <Expand className="h-3 w-3" />
            ขยายดู
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-5">
          <div className="grid size-10 place-items-center rounded-xl bg-white text-blue-600 shadow-sm">
            <FileText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">
              {fileLabel}
            </p>
            <Badge variant="slate" className="mt-1">
              PDF / Document
            </Badge>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {showImage ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
          >
            <Expand className="h-3.5 w-3.5" />
            {viewFullLabel}
          </Button>
        ) : null}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-8 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          เปิดไฟล์ต้นฉบับ
        </a>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-4xl p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>
              {title} · {documentNo}
            </DialogTitle>
            <DialogDescription>
              คลิกนอกกล่องหรือปุ่มปิดเพื่อกลับหน้ารายละเอียด
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[75vh] overflow-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={url}
              alt={`${title}เต็ม ${documentNo}`}
              className="mx-auto max-h-[70vh] w-auto max-w-full object-contain"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
