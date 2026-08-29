"use client";

/**
 * URL-driven slide-over for WHT Report document preview.
 * Opens when `?view_wht_source=EXP|TB&view_wht_id=<uuid>` is present.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { ExternalLink, FileText } from "lucide-react";
import type { WHTReportSource } from "@/types/tax";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const VIEW_WHT_SOURCE_PARAM = "view_wht_source";
export const VIEW_WHT_ID_PARAM = "view_wht_id";

export type WhtDocumentPreviewTarget = {
  source: WHTReportSource;
  documentId: string;
} | null;

export function parseWhtDocumentPreviewTarget(
  rawSource?: string,
  rawId?: string,
): WhtDocumentPreviewTarget {
  const source = rawSource?.trim().toUpperCase();
  const documentId = rawId?.trim() ?? "";
  if (!documentId) return null;
  if (source === "EXP" || source === "TB") {
    return { source, documentId };
  }
  return null;
}

/** Set preview params while preserving year/month and other search params. */
export function buildViewWhtHref(
  pathname: string,
  currentSearch: string,
  source: WHTReportSource,
  documentId: string,
): string {
  const params = new URLSearchParams(currentSearch);
  params.set(VIEW_WHT_SOURCE_PARAM, source);
  params.set(VIEW_WHT_ID_PARAM, documentId);
  return `${pathname}?${params.toString()}`;
}

export type WhtDocumentPreviewSheetProps = {
  target: WhtDocumentPreviewTarget;
  children: ReactNode;
};

function previewTitle(source: WHTReportSource): string {
  return source === "TB"
    ? "สรุปวางบิลช่าง (Technician Bill)"
    : "รายละเอียดค่าใช้จ่าย (Expense)";
}

function previewDescription(source: WHTReportSource): string {
  return source === "TB"
    ? "Read-only — ตรวจสอบยอดค่าแรงและ WHT โดยไม่ต้องออกจากหน้ารายงาน"
    : "Read-only — ตรวจสอบรายละเอียดและสลิปโดยไม่ต้องออกจากหน้ารายงาน";
}

function fullPageHref(target: NonNullable<WhtDocumentPreviewTarget>): string {
  if (target.source === "TB") {
    return `/purchases/${encodeURIComponent(target.documentId)}`;
  }
  return `/expenses/${target.documentId}`;
}

export function WhtDocumentPreviewSheet({
  target,
  children,
}: WhtDocumentPreviewSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = Boolean(target);

  function closeSheet() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(VIEW_WHT_SOURCE_PARAM);
    params.delete(VIEW_WHT_ID_PARAM);
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) closeSheet();
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            {target ? previewTitle(target.source) : "รายละเอียดเอกสาร"}
          </SheetTitle>
          <SheetDescription>
            {target ? previewDescription(target.source) : "ตรวจสอบเอกสารหัก ณ ที่จ่าย"}
          </SheetDescription>
        </SheetHeader>

        {children}

        {target ? (
          <SheetFooter className="sm:justify-start">
            <Link
              href={fullPageHref(target)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              เปิดหน้าเต็ม
            </Link>
          </SheetFooter>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
