import { DocumentPrintHeader } from "@/components/shared/print/DocumentPrintHeader";
import { DocumentPrintFooter } from "@/components/shared/print/DocumentPrintFooter";
import type { PrintLayoutProps, PrintPaperSize } from "@/types/print-document";
import { cn } from "@/lib/utils";

const PAPER_PREVIEW: Record<
  PrintPaperSize,
  { width: string; minHeight: string; padding: string }
> = {
  A4: {
    width: "w-[210mm]",
    minHeight: "min-h-[297mm]",
    padding: "p-8",
  },
  "A5-Portrait": {
    width: "w-[148mm]",
    minHeight: "min-h-[210mm]",
    padding: "p-5",
  },
  "A5-Landscape": {
    width: "w-[210mm]",
    minHeight: "min-h-[148mm]",
    padding: "p-5",
  },
};

function pageRuleFor(paperSize: PrintPaperSize): string {
  switch (paperSize) {
    case "A5-Portrait":
      return "@page { size: A5 portrait; margin: 10mm; }";
    case "A5-Landscape":
      return "@page { size: A5 landscape; margin: 10mm; }";
    case "A4":
    default:
      return "@page { size: A4; margin: 10mm; }";
  }
}

/**
 * Print Layout Wrapper (TFRS / Enterprise ERP) — รองรับ A4 / A5.
 * บังคับโครงสร้าง: Header (company SSOT) → Content → Footer (signatures)
 * Header ใช้ Flex ซ้าย-ขวาตายตัวใน DocumentPrintHeader (ไม่พับแนวตั้งบน A5)
 * `@page size` ถูก inject แบบ dynamic ตาม `paperSize`
 */
export async function PrintLayout({
  title,
  documentNo,
  date,
  customerData,
  dueDate,
  partyLabel,
  status,
  referenceNo,
  children,
  footer,
  className,
  documentId = "erp-print-document",
  paperSize = "A4",
}: PrintLayoutProps) {
  const preview = PAPER_PREVIEW[paperSize] ?? PAPER_PREVIEW.A4;

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: `@media print { ${pageRuleFor(paperSize)} }`,
        }}
      />

      <article
        id={documentId}
        data-paper-size={paperSize}
        className={cn(
          "erp-print-document mx-auto flex flex-col bg-white text-black",
          /* Screen preview — จำลองแผ่นกระดาษลอย */
          preview.width,
          preview.minHeight,
          preview.padding,
          "shadow-lg ring-1 ring-black/5",
          /* Print — ลบเงา/กรอบ/พื้นหลังจำลอง ให้พิมพ์สะอาด */
          "print:m-0 print:w-full print:min-h-0 print:max-w-none print:p-0",
          "print:bg-transparent print:shadow-none print:ring-0",
          className,
        )}
      >
        <DocumentPrintHeader
          title={title}
          documentNo={documentNo}
          date={date}
          customerData={customerData}
          dueDate={dueDate}
          partyLabel={partyLabel}
          status={status}
          referenceNo={referenceNo}
        />

        <section className="erp-print-content mt-3 flex-1 text-[11px] text-neutral-900">
          {children}
        </section>

        <DocumentPrintFooter {...footer} />
      </article>
    </>
  );
}
