"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PaymentChannelPicker } from "@/components/finance/payment-channel-picker";
import { uploadDocumentImage } from "@/lib/actions/document-actions";
import { parseTransferSlipOcr } from "@/lib/actions/sales-ocr-actions";
import {
  resolveSlipBankAccount,
  type ActiveBankAccount,
  type PaymentChannel,
} from "@/lib/finance/payment-channel";
import { formatBuddhistSlash } from "@/lib/utils/deposit-note";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function CashReceiptPaymentBox({
  channel,
  bankAccountId,
  accounts,
  referenceNo,
  slipUrl,
  disabled = false,
  onChannelChange,
  onReferenceChange,
  onSlipUrlChange,
  onSlipDate,
}: {
  channel: PaymentChannel;
  bankAccountId: string | null;
  accounts: ActiveBankAccount[];
  referenceNo: string;
  slipUrl: string;
  disabled?: boolean;
  onChannelChange: (channel: PaymentChannel, bankAccountId: string | null) => void;
  onReferenceChange: (value: string) => void;
  onSlipUrlChange: (url: string) => void;
  onSlipDate?: (isoDate: string) => void;
}) {
  const [reading, setReading] = useState(false);
  const showSlip = channel === "COMPANY_BANK" || channel === "OTHER_BANK";

  async function readSlip(file: File | null) {
    if (!file || file.size <= 0 || disabled) return;
    setReading(true);
    try {
      const uploadData = new FormData();
      uploadData.set("file", file);
      const uploaded = await uploadDocumentImage(uploadData);
      if (uploaded.error || !uploaded.data?.url) {
        toast.error(uploaded.error ?? "อัปโหลดสลิปไม่สำเร็จ");
        return;
      }
      onSlipUrlChange(uploaded.data.url);
      const parsed = await parseTransferSlipOcr(uploadData);
      if (parsed.error || !parsed.data) {
        toast.message("แนบสลิปแล้ว — อ่านวันที่หรือเลขอ้างอิงจากสลิปไม่สำเร็จ");
        return;
      }
      if (parsed.data.doc_date) {
        onSlipDate?.(parsed.data.doc_date);
        toast.success(
          `ดึงวันที่โอนจากสลิป: ${formatBuddhistSlash(parsed.data.doc_date)} อัตโนมัติ`,
        );
      }
      if (parsed.data.reference_no) onReferenceChange(parsed.data.reference_no);
      const payee = resolveSlipBankAccount(
        accounts,
        parsed.data.payee_name,
        parsed.data.payee_account,
      );
      if (payee) {
        onChannelChange(payee.channel, payee.bankAccountId);
        toast.message(payee.notice);
      }
    } finally {
      setReading(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-sky-200 bg-sky-50/60 p-3">
      <p className="text-sm font-semibold text-sky-950">
        💳 ช่องทางการรับเงิน & สลิปโอนเงิน
      </p>
      <PaymentChannelPicker
        value={channel}
        bankAccountId={bankAccountId}
        accounts={accounts}
        disabled={disabled || reading}
        onChange={onChannelChange}
      />
      {showSlip ? (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="cash-receipt-slip-ref">เลขที่อ้างอิงสลิป</Label>
            <Input
              id="cash-receipt-slip-ref"
              value={referenceNo}
              disabled={disabled || reading}
              placeholder="เลขสลิปโอนเงิน"
              onChange={(event) => onReferenceChange(event.target.value)}
              className="h-10"
            />
          </div>
          <div
            className="space-y-1.5"
            onDragOver={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            onDrop={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void readSlip(event.dataTransfer.files?.[0] ?? null);
            }}
          >
            <Label htmlFor="cash-receipt-slip">แนบรูปสลิปโอนเงิน</Label>
            <Input
              id="cash-receipt-slip"
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              disabled={disabled || reading}
              onChange={(event) => {
                void readSlip(event.target.files?.[0] ?? null);
              }}
            />
            {reading ? (
              <p className="flex items-center gap-2 text-xs text-slate-600">
                <Loader2 className="size-3 animate-spin" />
                กำลังอ่านสลิป...
              </p>
            ) : slipUrl ? (
              <a
                href={slipUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-sky-800 underline"
              >
                📎 แนบรูปสลิปโอนเงินแล้ว
              </a>
            ) : (
              <p className="text-xs text-slate-500">📎 แนบรูปสลิปโอนเงิน</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}
