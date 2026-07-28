"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

export type PrintDocumentButtonProps = {
  className?: string;
};

export default function PrintDocumentButton({
  className,
}: PrintDocumentButtonProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className={className}
      onClick={() => window.print()}
    >
      <Printer className="size-4" />
      พิมพ์เอกสาร
    </Button>
  );
}
