"use client";

/**
 * URL-driven document preview slide-over (Approval Center).
 * Opens when `?preview_doc_id=<uuid>` is present — close clears the param.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { FileText } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export const PREVIEW_DOC_PARAM = "preview_doc_id";

export type DocumentPreviewSheetProps = {
  previewDocId: string | null;
  children: ReactNode;
};

export function DocumentPreviewSheet({
  previewDocId,
  children,
}: DocumentPreviewSheetProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const open = Boolean(previewDocId);

  function closeSheet() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete(PREVIEW_DOC_PARAM);
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
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
            รายละเอียดเอกสาร
          </SheetTitle>
          <SheetDescription>
            Read-only — ตรวจสอบยอดเงิน คืนเงินมัดจำ หมายเหตุ และสลิปโอนเงินก่อนอนุมัติหรือปฏิเสธ
          </SheetDescription>
        </SheetHeader>
        {children}
      </SheetContent>
    </Sheet>
  );
}

/** Set `preview_doc_id` while preserving other search params (e.g. tab). */
export function buildPreviewDocHref(
  pathname: string,
  currentSearch: string,
  documentId: string,
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("tab", "documents");
  params.set(PREVIEW_DOC_PARAM, documentId);
  params.delete("view_expense");
  return `${pathname}?${params.toString()}`;
}
