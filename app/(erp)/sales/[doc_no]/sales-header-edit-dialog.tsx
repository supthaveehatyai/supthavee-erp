"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { updateSalesDocumentDirect } from "@/lib/actions/document-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SalesHeaderEditDialog({
  documentId,
  docDate,
  notes,
}: {
  documentId: string;
  docDate: string;
  notes: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(docDate.slice(0, 10));
  const [remark, setRemark] = useState(notes);

  function onSave() {
    if (pending) return;
    startTransition(async () => {
      const result = await updateSalesDocumentDirect({
        document_id: documentId,
        doc_date: date,
        notes: remark.trim() || null,
      });
      if (result.error || !result.data) {
        toast.error(result.error ?? "แก้ไขหัวบิลไม่สำเร็จ");
        return;
      }
      toast.success("บันทึกหัวบิลแล้ว");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        className="h-10 gap-2 bg-blue-800 text-white hover:bg-blue-900"
        onClick={() => setOpen(true)}
      >
        <Pencil className="size-4" />
        ✏️ แก้ไขข้อมูลหัวบิล / วันที่ / หมายเหตุ
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>แก้ไขหัวบิลที่ออกแล้ว</DialogTitle>
            <DialogDescription>
              ปรับวันที่และหมายเหตุโดยไม่ยกเลิกเอกสาร และไม่แก้รายการสินค้า
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="issued-doc-date">วันที่เอกสาร</Label>
              <Input
                id="issued-doc-date"
                type="date"
                value={date}
                disabled={pending}
                onChange={(event) => setDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="issued-notes">หมายเหตุ / ชื่องาน</Label>
              <textarea
                id="issued-notes"
                rows={4}
                value={remark}
                disabled={pending}
                onChange={(event) => setRemark(event.target.value)}
                className="flex w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={() => setOpen(false)}>
                ยกเลิก
              </Button>
              <Button
                type="button"
                className="bg-blue-800 text-white hover:bg-blue-900"
                disabled={pending}
                onClick={onSave}
              >
                {pending ? <Loader2 className="size-4 animate-spin" /> : null}
                บันทึกหัวบิล
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
