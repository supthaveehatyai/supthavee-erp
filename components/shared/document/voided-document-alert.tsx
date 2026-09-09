import { Ban } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { stripVoidedRemarkPrefix } from "@/lib/utils/void-remark";

export type VoidedDocumentAlertProps = {
  /** `documents.remark` — เหตุผลการยกเลิก (อาจมี prefix `[VOIDED]:`) */
  remark: string | null | undefined;
};

export function VoidedDocumentAlert({ remark }: VoidedDocumentAlertProps) {
  const reason = stripVoidedRemarkPrefix(remark);

  return (
    <Alert variant="destructive" className="print:hidden">
      <div className="flex items-start gap-3">
        <Ban className="mt-0.5 size-4 shrink-0 text-red-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <AlertTitle>เอกสารนี้ถูกยกเลิก (VOID)</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap text-red-800/90">
            {`เหตุผล: ${reason || "—"}`}
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}
