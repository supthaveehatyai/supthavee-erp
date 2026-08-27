"use client";

/**
 * Read-only expense attachment preview + slide-over Sheet viewer.
 * Used for receipt (`receipt_url`) and payment slip (`payment_slip_url`).
 * Phase 14: accepts storage_tier / nas_archive_url (resolved on Server).
 */

import { Expand, Eye, FileText, HardDrive } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AttachmentSheetViewer } from "@/components/shared/attachment-sheet-viewer";
import { TieredStorageImage } from "@/components/shared/tiered-storage-image";
import {
  isHttpUrl,
  resolveStorageDisplayUrl,
} from "@/lib/utils/storage-tier";
import type { StorageTier } from "@/types/storage-tier";

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
  /** Phase 14 Tiered Storage — from payment_transactions (Server-resolved props) */
  storageTier?: StorageTier | null;
  nasArchiveUrl?: string | null;
};

function isProbablyImageUrl(url: string): boolean {
  const path = url.split("?")[0]?.toLowerCase() ?? "";
  if (/\.pdf$/i.test(path)) return false;
  if (/\.(jpe?g|png|webp|gif)$/i.test(path)) return true;
  return (
    path.includes("/exp-") ||
    path.includes("/slip-") ||
    path.includes("expense_documents") ||
    path.includes("document_attachments") ||
    path.includes("payment")
  );
}

export function ExpenseAttachmentPreview({
  url: rawUrl,
  documentNo,
  title,
  emptyLabel,
  fileLabel = "ไฟล์แนบ",
  viewFullLabel = "ขยายดูเต็มจอ",
  storageTier = "CLOUD",
  nasArchiveUrl = null,
}: ExpenseAttachmentPreviewProps) {
  const resolved = resolveStorageDisplayUrl({
    storageTier,
    cloudUrl: rawUrl,
    nasArchiveUrl,
  });

  const url = resolved.url?.trim() || "";
  const tier = resolved.tier;

  if (!url && tier !== "NAS") {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  if (tier === "NAS" && !resolved.isBrowsable) {
    return (
      <div className="space-y-3">
        <div className="relative flex min-h-40 flex-col items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-8 text-center">
          <HardDrive className="size-8 text-amber-700" />
          <p className="text-sm font-semibold text-amber-900">
            สลิปถูกเก็บถาวรบน NAS
          </p>
          {resolved.nasPath ? (
            <p className="max-w-full break-all text-xs text-amber-800/80">
              {resolved.nasPath}
            </p>
          ) : null}
          <Badge variant="slate">storage_tier = NAS</Badge>
        </div>
      </div>
    );
  }

  if (!url) {
    return <p className="text-sm text-slate-500">{emptyLabel}</p>;
  }

  const showImage = isProbablyImageUrl(url) || isHttpUrl(url);
  const sheetTitle = `${title} · ${documentNo}`;

  return (
    <div className="space-y-3">
      {showImage ? (
        <AttachmentSheetViewer
          fileUrl={url}
          title={sheetTitle}
          storageTier={tier}
          trigger={
            <button
              type="button"
              className="group relative block w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-50 text-left transition hover:border-blue-300 hover:shadow-sm"
            >
              <div className="relative mx-auto max-h-64 min-h-40 w-full">
                <TieredStorageImage
                  src={url}
                  alt={`${title} ${documentNo}`}
                  storageTier={tier}
                  nasPath={resolved.nasPath}
                  fill
                  sizes="(max-width: 768px) 100vw, 480px"
                  objectFit="contain"
                  showTierBadge={tier === "NAS"}
                  className="max-h-64"
                />
              </div>
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
        <AttachmentSheetViewer
          fileUrl={url}
          title={sheetTitle}
          storageTier={tier}
          trigger={
            <Button type="button" variant="outline" size="sm">
              {showImage ? (
                <Expand className="h-3.5 w-3.5" />
              ) : (
                <Eye className="h-3.5 w-3.5" />
              )}
              {showImage ? viewFullLabel : "ดูไฟล์แนบ"}
            </Button>
          }
        />
      </div>
    </div>
  );
}
