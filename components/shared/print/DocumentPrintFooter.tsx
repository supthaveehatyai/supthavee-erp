import type { DocumentPrintFooterProps } from "@/types/print-document";
import { cn } from "@/lib/utils";

function SignatureBox({ label, compact = false }: { label: string; compact?: boolean }) {
  return (
    <div className="flex flex-col items-center text-center text-[11px] text-neutral-800">
      <div
        className={cn(
          "w-full max-w-[9rem] border-b border-neutral-500",
          compact ? "mb-3 h-7" : "mb-8 h-12",
        )}
      />
      <p className="font-semibold">({label})</p>
      <p className={cn("text-neutral-600", compact ? "mt-1" : "mt-3")}>
        วันที่ ....../....../..........
      </p>
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
  compact = false,
}: DocumentPrintFooterProps) {
  return (
    <footer
      className={cn(
        "mt-auto border-t border-neutral-300 print:break-inside-avoid",
        compact ? "pt-3" : "pt-6",
        className,
      )}
    >
      <div className={cn("grid grid-cols-3", compact ? "gap-2" : "gap-4")}>
        <SignatureBox label={preparedLabel} compact={compact} />
        <SignatureBox label={receivedLabel} compact={compact} />
        <SignatureBox label={approvedLabel} compact={compact} />
      </div>
      <p className={cn("text-center text-[9px] text-neutral-400", compact ? "mt-2" : "mt-6")}>
        เอกสารนี้จัดพิมพ์จากระบบ Supthavee ERP — ข้อมูลบริษัทอ้างอิงจาก
        system_settings (SSOT)
      </p>
    </footer>
  );
}
