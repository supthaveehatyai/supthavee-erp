"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PrintDocumentButtonProps = {
  className?: string;
  label?: string;
  variant?: "outline" | "default";
};

/**
 * Client island — triggers browser print dialog (window.print).
 * Screen chrome is hidden via print:hidden / @media print in globals.css.
 */
export default function PrintDocumentButton({
  className,
  label = "พิมพ์เอกสาร",
  variant = "outline",
}: PrintDocumentButtonProps) {
  return (
    <Button
      type="button"
      variant={variant}
      className={className}
      onClick={() => window.print()}
    >
      <Printer className="size-4" />
      {label}
    </Button>
  );
}
