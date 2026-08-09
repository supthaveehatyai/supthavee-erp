import type { DocumentPrintFooterProps } from "@/types/print-document";
import { cn } from "@/lib/utils";

function SignatureBox({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center text-center text-[11px] text-neutral-800">
      <div className="mb-8 h-12 w-full max-w-[9rem] border-b border-neutral-500" />
      <p className="font-semibold">({label})</p>
      <p className="mt-3 text-neutral-600">วันที่ ....../....../..........</p>
    </div>
  );
}

/**
 * A4 print footer — ช่องเซ็นชื่อมาตรฐาน ERP (ผู้จัดทำ / ผู้รับของ / ผู้อนุมัติ)
 */
export function DocumentPrintFooter({
  preparedLabel = "ผู้จัดทำ",
  receivedLabel = "ผู้รับของ",
  approvedLabel = "ผู้อนุมัติ",
  className,
}: DocumentPrintFooterProps) {
  return (
    <footer
      className={cn(
        "mt-auto border-t border-neutral-300 pt-6 print:break-inside-avoid",
        className,
      )}
    >
      <div className="grid grid-cols-3 gap-4">
        <SignatureBox label={preparedLabel} />
        <SignatureBox label={receivedLabel} />
        <SignatureBox label={approvedLabel} />
      </div>
      <p className="mt-6 text-center text-[9px] text-neutral-400">
        เอกสารนี้จัดพิมพ์จากระบบ Supthavee ERP — ข้อมูลบริษัทอ้างอิงจาก
        system_settings (SSOT)
      </p>
    </footer>
  );
}
