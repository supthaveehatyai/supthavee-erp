import { Ban } from "lucide-react";
import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { stripVoidedRemarkPrefix } from "@/lib/utils/void-remark";

export type VoidedDocumentAlertProps = {
  /** `documents.notes` — remark / หมายเหตุ (อาจมี prefix `[VOIDED]:`) */
  remark: string | null | undefined;
};

export function VoidedDocumentAlert({ remark }: VoidedDocumentAlertProps) {
  const reason = stripVoidedRemarkPrefix(remark);

  return (
    <Alert variant="destructive" className="print:hidden">
      <div className="flex items-start gap-3">
        <Ban className="mt-0.5 size-4 shrink-0 text-red-700" aria-hidden />
        <div className="min-w-0 flex-1">
          <AlertTitle>เอกสารถูกยกเลิก (VOID)</AlertTitle>
          <AlertDescription className="whitespace-pre-wrap text-red-800/90">
            {reason || "เอกสารถูกยกเลิกแล้ว"}
          </AlertDescription>
        </div>
      </div>
    </Alert>
  );
}
