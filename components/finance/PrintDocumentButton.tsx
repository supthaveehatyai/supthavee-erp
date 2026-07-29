"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PrintDocumentButtonProps = {
  className?: string;
  label?: string;
};

/**
 * Client island — triggers browser print dialog (window.print).
 * Screen chrome is hidden via print:hidden / @media print in globals.css.
 */
export default function PrintDocumentButton({
  className,
  label = "พิมพ์เอกสาร",
}: PrintDocumentButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() => window.print()}
    >
      <Printer className="size-4" />
      {label}
    </Button>
  );
}
