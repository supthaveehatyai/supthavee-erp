import { DocumentPrintHeader } from "@/components/shared/print/DocumentPrintHeader";
import { DocumentPrintFooter } from "@/components/shared/print/DocumentPrintFooter";
import type { PrintLayoutProps, PrintPaperSize } from "@/types/print-document";
import { cn } from "@/lib/utils";

const PAPER_PREVIEW: Record<
  PrintPaperSize,
  { frame: string; printMin: string; padding: string }
> = {
  A4: {
    frame: "w-[210mm] max-w-[210mm] min-h-[297mm]",
    printMin: "print:min-h-[281mm]",
    padding: "p-6",
  },
  "A5-Portrait": {
    frame: "w-[148mm] max-w-[148mm] min-h-[210mm]",
    printMin: "print:min-h-[194mm]",
    padding: "px-2.5 py-3",
  },
  "A5-Landscape": {
    frame: "w-[210mm] max-w-[210mm] min-h-[148mm]",
    printMin: "print:min-h-[132mm]",
    padding: "p-4",
  },
};

function pageRuleFor(paperSize: PrintPaperSize, abbSheet: boolean): string {
  if (abbSheet) return "@page { size: A5 portrait; margin: 6mm 8mm; }";
  switch (paperSize) {
    case "A5-Portrait":
      return "@page { size: A5 portrait; margin: 8mm; }";
    case "A5-Landscape":
      return "@page { size: A5 landscape; margin: 8mm; }";
    case "A4":
    default:
      return "@page { size: A4 portrait; margin: 8mm; }";
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
  docType,
  titleSubtitle,
  headerVariant = "default",
  respectPrinterPaper = false,
  children,
  bottom,
  footer,
  className,
  documentId = "erp-print-document",
  paperSize = "A4",
  contactPersonName,
  customerCompact = false,
  officialReference,
  showSignatureFooter = true,
  stackContent = false,
}: PrintLayoutProps) {
  const preview = PAPER_PREVIEW[paperSize] ?? PAPER_PREVIEW.A4;
  const abbSheet = headerVariant === "sales-tax" && paperSize === "A5-Portrait";

  return (
    <>
      <style
        dangerouslySetInnerHTML={{
          __html: respectPrinterPaper
            ? "@media print { @page { margin: 6mm; } }"
            : `@media print { ${pageRuleFor(paperSize, abbSheet)} }`,
        }}
      />

      <article
        id={documentId}
        data-paper-size={paperSize}
        className={cn(
          "erp-print-document mx-auto flex flex-col bg-white text-black",
          stackContent ? "justify-start" : "justify-between",
          abbSheet
            ? "max-w-[148mm] min-h-[200mm] p-4 text-[11px] leading-snug print:w-[148mm] print:max-w-[148mm] print:p-[6mm_8mm]"
            : [preview.frame, preview.printMin, preview.padding],
          "shadow-lg ring-1 ring-black/5",
          "print:mx-auto print:shadow-none print:ring-0 print:bg-white",
          abbSheet ? "print:w-[148mm] print:max-w-[148mm]" : "print:w-full print:max-w-none",
          className,
        )}
      >
        <div className="min-h-0">
        <DocumentPrintHeader
          title={title}
          documentNo={documentNo}
          date={date}
          customerData={customerData}
          dueDate={dueDate}
          partyLabel={partyLabel}
          status={status}
          referenceNo={referenceNo}
          docType={docType}
          titleSubtitle={titleSubtitle}
          headerVariant={headerVariant}
          paperSize={paperSize}
          contactPersonName={contactPersonName}
          customerCompact={customerCompact}
          officialReference={officialReference}
        />

        <section
          className={cn(
            "erp-print-content text-neutral-900",
            headerVariant === "sales-tax"
              ? "mt-0 text-[10.5px]"
              : headerVariant === "goods-receipt"
                ? "mt-2 text-[10px]"
                : "mt-3 text-[11px]",
          )}
        >
          {children}
        </section>
        </div>

        <div className={headerVariant === "sales-tax" ? "mt-1" : "mt-4"}>
          {bottom}
          {showSignatureFooter ? <DocumentPrintFooter {...footer} /> : null}
        </div>
      </article>
    </>
  );
}
