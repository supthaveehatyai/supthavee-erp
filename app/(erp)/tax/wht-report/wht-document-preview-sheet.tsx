"use client";

/**
 * URL-driven slide-over for WHT Report document preview.
 * Opens when `?view_wht_source=EXP|TB&view_wht_id=<uuid>` is present.
 */

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { ExternalLink, FileText } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  fullPagePreviewHref,
  previewDescription,
  previewTitle,
  VIEW_WHT_ID_PARAM,
  VIEW_WHT_SOURCE_PARAM,
  type WhtDocumentPreviewTarget,
} from "./wht-document-preview-utils";

export type WhtDocumentPreviewSheetProps = {
  target: WhtDocumentPreviewTarget;
  children: ReactNode;
};

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
            {target
              ? previewDescription(target.source)
              : "ตรวจสอบเอกสารหัก ณ ที่จ่าย"}
          </SheetDescription>
        </SheetHeader>

        {children}

        {target ? (
          <SheetFooter className="sm:justify-start">
            <Link
              href={fullPagePreviewHref(target)}
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
