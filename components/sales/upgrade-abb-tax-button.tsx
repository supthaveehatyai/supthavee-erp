"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { upgradeAbbToFullTaxInvoice } from "@/lib/actions/document-actions";
import { Button } from "@/components/ui/button";

export function UpgradeAbbTaxButton({ documentId }: { documentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function upgrade(target: "TAX_INV" | "CS_TAX") {
    setOpen(false);
    startTransition(async () => {
      const result = await upgradeAbbToFullTaxInvoice(documentId, target);
      if (result.error || !result.data) {
        toast.error(result.error ?? "เปลี่ยนเป็นใบกำกับภาษีเต็มรูปไม่สำเร็จ");
        return;
      }
      toast.success(`สร้างร่าง ${result.data.doc_type} ${result.data.doc_no} (VAT นอก)`);
      router.push(`/sales/edit/${encodeURIComponent(result.data.document_id)}`);
    });
  }

  return (
    <div className="relative">
      <Button
        type="button"
        variant="outline"
        disabled={isPending}
        onClick={() => setOpen((current) => !current)}
        className="h-10 gap-2 border-amber-200 bg-amber-50 font-semibold text-amber-900 hover:bg-amber-100"
      >
        {isPending ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
        🔄 เปลี่ยนเป็นใบกำกับภาษีเต็มรูป (TAX_INV / CS_TAX - VAT นอก)
      </Button>
      {open ? (
        <div className="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
            onClick={() => upgrade("TAX_INV")}
          >
            ใบกำกับภาษีเงินเชื่อ (TAX_INV)
          </button>
          <button
            type="button"
            className="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
            onClick={() => upgrade("CS_TAX")}
          >
            ใบเสร็จรับเงิน / ใบกำกับภาษี (CS_TAX)
          </button>
        </div>
      ) : null}
    </div>
  );
}
