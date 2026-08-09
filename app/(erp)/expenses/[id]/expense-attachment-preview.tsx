"use client";

/**
 * Read-only expense attachment preview + slide-over Sheet viewer.
 * Used for receipt (`receipt_url`) and payment slip (`payment_slip_url`).
 */

import { Expand, Eye, FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AttachmentSheetViewer } from "@/components/shared/attachment-sheet-viewer";

export type ExpenseAttachmentPreviewProps = {
  url: string | null | undefined;
  documentNo: string;
  /** Sheet / alt title, e.g. "ใบเสร็จ" or "สลิปโอนเงิน" */
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
  const url = rawUrl?.trim() || "";

  if (!url) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  const showImage = isProbablyImageUrl(url);
  const sheetTitle = `${title} · ${documentNo}`;

  return (
    <div className="space-y-3">
      {showImage ? (
        <AttachmentSheetViewer
          fileUrl={url}
          title={sheetTitle}
          trigger={
            <button
              type="button"
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
          }
        />
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
          <AttachmentSheetViewer
            fileUrl={url}
            title={sheetTitle}
            trigger={
              <Button type="button" variant="outline" size="sm">
                <Expand className="h-3.5 w-3.5" />
                {viewFullLabel}
              </Button>
            }
          />
        ) : (
          <AttachmentSheetViewer
            fileUrl={url}
            title={sheetTitle}
            trigger={
              <Button type="button" variant="outline" size="sm">
                <Eye className="h-3.5 w-3.5" />
                ดูไฟล์แนบ
              </Button>
            }
          />
        )}
      </div>
    </div>
  );
}
