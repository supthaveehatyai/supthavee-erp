"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  deleteBillingNoteAction,
  getUnbilledInvoices,
  updateBillingNoteAction,
} from "@/app/actions/billing";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { coerceBillingDueDate } from "@/lib/utils/billing-period";
import type { BillingNoteDocType } from "@/types/billing";

type EditableLine = {
  id: string;
  docNo: string;
  referenceNo?: string | null;
  amount: number;
};

function lineLabel(line: EditableLine): string {
  const ref = line.referenceNo?.trim() ?? "";
  if (ref && ref !== line.docNo) return `${line.docNo} (Ref: ${ref})`;
  return line.docNo;
}

export function DeleteBillingNoteButton({
  billingNoteId,
  docNo,
  redirectTo,
  compact = false,
}: {
  billingNoteId: string;
  docNo: string;
  redirectTo?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function confirmDelete() {
    startTransition(async () => {
      const result = await deleteBillingNoteAction(billingNoteId);
      if (!result.success) {
        toast.error(result.error ?? "ลบใบวางบิลไม่สำเร็จ");
        return;
      }
      toast.success(`ลบใบวางบิล ${docNo} แล้ว บิลย่อยกลับเข้าคิวรอวางบิล`);
      setOpen(false);
      if (redirectTo) {
        router.push(redirectTo);
        router.refresh();
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className={
          compact
            ? "h-8 rounded-lg border-red-200 bg-red-50 px-2 text-xs font-semibold text-red-700 hover:bg-red-100"
            : "h-10 rounded-xl border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
        }
        onClick={() => setOpen(true)}
      >
        <Trash2 className="size-3.5" />
        {compact ? "ลบ" : "ลบใบวางบิล"}
      </Button>
      <AlertDialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ลบใบวางบิล</AlertDialogTitle>
            <AlertDialogDescription>
              {`ยืนยันการลบใบวางบิล ${docNo}? บิลย่อยข้างในทั้งหมดจะถูกปลดล็อกกลับเข้าคิวรอวางบิลทันที`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>ยกเลิก</AlertDialogCancel>
            <AlertDialogAction disabled={isPending} onClick={confirmDelete}>
              {isPending ? "กำลังลบ..." : "ยืนยันลบ"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export function EditBillingNoteButton({
  billingNoteId,
  docType,
  docNo,
  docDate,
  dueDate,
  notes,
  contactId,
  lines,
}: {
  billingNoteId: string;
  docType: BillingNoteDocType;
  docNo: string;
  docDate: string;
  dueDate: string | null;
  notes?: string | null;
  contactId: string;
  lines: EditableLine[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [draftDate, setDraftDate] = useState(docDate.slice(0, 10));
  const [draftDue, setDraftDue] = useState((dueDate ?? docDate).slice(0, 10));
  const [draftNotes, setDraftNotes] = useState(notes ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(lines.map((line) => line.id)));
  const [extraLines, setExtraLines] = useState<EditableLine[]>([]);

  const currentLineKey = lines.map((line) => line.id).join(",");

  useEffect(() => {
    if (!open || docType === "TB" || !contactId) return;
    let cancelled = false;
    const current = new Set(currentLineKey.split(",").filter(Boolean));
    void getUnbilledInvoices(contactId, docType === "BN" ? "AR" : "AP").then((result) => {
      if (cancelled) return;
      setExtraLines(
        result.data
          .filter((invoice) => !current.has(invoice.id))
          .map((invoice) => ({
            id: invoice.id,
            docNo: invoice.doc_no,
            referenceNo: invoice.tax_invoice_no || invoice.reference_no,
            amount: invoice.outstanding_amount,
          })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [open, docType, contactId, currentLineKey]);

  const choices = useMemo(() => [...lines, ...extraLines], [lines, extraLines]);

  function openEditor() {
    setDraftDate(docDate.slice(0, 10));
    setDraftDue(coerceBillingDueDate(docDate.slice(0, 10), (dueDate ?? docDate).slice(0, 10), 0));
    setDraftNotes(notes ?? "");
    setSelectedIds(new Set(lines.map((line) => line.id)));
    setExtraLines([]);
    setOpen(true);
  }

  function save() {
    startTransition(async () => {
      const result = await updateBillingNoteAction({
        billingNoteId,
        docDate: draftDate,
        dueDate: draftDue,
        notes: draftNotes,
        invoiceIds: docType === "TB" ? undefined : Array.from(selectedIds),
        autoRenumber: true,
      });
      if (!result.success) {
        toast.error(result.error ?? "แก้ไขใบวางบิลไม่สำเร็จ");
        return;
      }
      const nextNo = result.docNo && result.docNo !== docNo ? ` เลขที่ใหม่ ${result.docNo}` : "";
      toast.success(`แก้ไขใบวางบิลแล้ว${nextNo}`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button type="button" variant="outline" className="h-10 rounded-xl" onClick={openEditor}>
        <Pencil className="size-4" />
        แก้ไขใบวางบิล
      </Button>
      <Dialog open={open} onOpenChange={(next) => !isPending && setOpen(next)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>แก้ไขใบวางบิล {docNo}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="edit-billing-date">วันที่เอกสารวางบิล</Label>
                <Input
                  id="edit-billing-date"
                  type="date"
                  value={draftDate}
                  onChange={(event) => {
                    const next = event.target.value;
                    setDraftDate(next);
                    setDraftDue((current) => coerceBillingDueDate(next, current, 0));
                  }}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-due-date">วันครบกำหนดชำระ</Label>
                <Input
                  id="edit-due-date"
                  type="date"
                  value={draftDue}
                  onChange={(event) => setDraftDue(coerceBillingDueDate(draftDate, event.target.value, 0))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-notes">หมายเหตุ</Label>
              <Input id="edit-notes" value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} />
            </div>
            {docType === "TB" ? (
              <p className="text-sm text-slate-500">
                การถอดรายการค่าแรงของช่างทำได้โดยลบใบสรุปนี้ แล้วจัดคิวใหม่
              </p>
            ) : (
              <div className="space-y-2">
                <p className="text-sm font-semibold text-slate-800">รายการบิลในใบวางบิล</p>
                <div className="max-h-56 space-y-2 overflow-y-auto rounded-lg border border-slate-200 p-2">
                  {choices.map((line) => (
                    <label key={line.id} className="flex items-start gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedIds.has(line.id)}
                        onChange={(event) => {
                          setSelectedIds((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(line.id);
                            else next.delete(line.id);
                            return next;
                          });
                        }}
                      />
                      <span>
                        {lineLabel(line)}
                        <span className="ml-2 tabular-nums text-slate-500">
                          {line.amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}
            <p className="text-xs text-slate-500">
              ถ้าเปลี่ยนเดือนของวันที่วางบิล ระบบจะออกเลขที่เอกสารให้ตรงเดือนใหม่
            </p>
          </div>
          <DialogFooter>
            <Button type="button" disabled={isPending || (docType !== "TB" && selectedIds.size === 0)} onClick={save}>
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              บันทึกการแก้ไข
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
