"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { voidSalesDocumentAction } from "@/lib/actions/document-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

const DEFAULT_VOID_REASON = "ออกเอกสารผิดพลาด / ยกเลิกรายการ";

export function VoidSalesDocumentButton({
  documentId,
  docNo,
}: {
  documentId: string;
  docNo: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(DEFAULT_VOID_REASON);
  const [pending, startTransition] = useTransition();

  function confirmVoid() {
    if (pending) return;
    const voidReason = reason.trim();
    if (!voidReason) {
      toast.error("กรุณาระบุสาเหตุการยกเลิก");
      return;
    }
    startTransition(async () => {
      const result = await voidSalesDocumentAction(documentId, voidReason);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success(`ยกเลิกเอกสาร ${docNo} แล้ว`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setReason(DEFAULT_VOID_REASON);
          setOpen(true);
        }}
        className="inline-flex h-10 items-center rounded-xl border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-700 transition hover:bg-red-100"
      >
        ❌ ยกเลิกเอกสาร (Void)
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>ยืนยันการยกเลิกเอกสาร</DialogTitle>
            <DialogDescription className="text-left text-sm leading-relaxed text-slate-700">
              การยกเลิกเอกสาร {docNo} จะทำการ: (1) คืนสต็อกสินค้ากลับเข้าคลังอัตโนมัติ (2) ปลดคู่ชนยอดธนาคารและปลดล็อกใบสั่งขายต้นทาง (ถ้ามี) และ (3) เปลี่ยนสถานะเอกสารเป็น VOID (ยกเลิกแล้ว) โดยคงเลขที่เอกสารไว้เพื่อการตรวจสอบทางบัญชี
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="void-sales-document-reason">สาเหตุการยกเลิก</Label>
            <textarea
              id="void-sales-document-reason"
              rows={3}
              value={reason}
              disabled={pending}
              onChange={(event) => setReason(event.target.value)}
              className="flex w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-red-300 focus:ring-2 focus:ring-red-100"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              ปิด
            </Button>
            <Button
              type="button"
              disabled={pending}
              className="bg-red-700 text-white hover:bg-red-800"
              onClick={confirmVoid}
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : null}
              ยืนยันยกเลิกเอกสาร
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
