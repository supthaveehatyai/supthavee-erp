"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { PaymentChannelPicker } from "@/components/finance/payment-channel-picker";
import { updateSalesDocumentDirect } from "@/lib/actions/document-actions";
import {
  isPaymentChannel,
  otherBankNameFromLabel,
  paymentChannelLabel,
  type PaymentChannel,
} from "@/lib/finance/payment-channel";
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
  referenceNo,
  paymentChannel,
  receivingBankLabel,
}: {
  documentId: string;
  docDate: string;
  notes: string;
  referenceNo: string;
  paymentChannel?: string | null;
  receivingBankLabel?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(docDate.slice(0, 10));
  const [slipNo, setSlipNo] = useState(referenceNo);
  const [remark, setRemark] = useState(notes);
  const [channel, setChannel] = useState<PaymentChannel>(
    isPaymentChannel(paymentChannel) ? paymentChannel : "COMPANY_BANK",
  );
  const [otherBankName, setOtherBankName] = useState(
    otherBankNameFromLabel(receivingBankLabel),
  );

  function onSave() {
    if (pending) return;
    startTransition(async () => {
      const result = await updateSalesDocumentDirect({
        document_id: documentId,
        doc_date: date,
        notes: remark.trim() || null,
        reference_no: slipNo.trim() || null,
        payment_channel: channel,
        receiving_bank_label: paymentChannelLabel(channel, otherBankName),
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
              ปรับวันที่ เลขสลิป ช่องทางรับเงิน และหมายเหตุโดยไม่ยกเลิกเอกสาร
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
              <Label htmlFor="issued-reference-no">เลขที่อ้างอิง / เลขสลิป</Label>
              <Input
                id="issued-reference-no"
                value={slipNo}
                disabled={pending}
                onChange={(event) => setSlipNo(event.target.value)}
                placeholder="เลขสลิปโอนเงิน / เลขที่บิลอ้างอิง"
              />
            </div>
            <PaymentChannelPicker
              value={channel}
              otherBankName={otherBankName}
              disabled={pending}
              onChange={(next, name) => {
                setChannel(next);
                setOtherBankName(name);
              }}
            />
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
