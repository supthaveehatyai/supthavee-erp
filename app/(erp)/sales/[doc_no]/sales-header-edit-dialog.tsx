"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { PaymentChannelPicker } from "@/components/finance/payment-channel-picker";
import { CashReceiptPaymentBox } from "@/components/sales/cash-receipt-payment-box";
import { updateSalesDocumentDirect } from "@/lib/actions/document-actions";
import {
  bankAccountDisplay,
  initialBankAccountId,
  initialCashReceiptChannel,
  paymentChannelLabel,
  selectedBankAccount,
  type ActiveBankAccount,
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
import { SalesShippingFields } from "@/components/sales/sales-shipping-fields";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function SalesHeaderEditDialog({
  documentId,
  docDate,
  notes,
  referenceNo,
  paymentChannel,
  receivingBankLabel,
  storedBankAccountId,
  bankAccounts = [],
  docType,
  salesChannel,
  slipUrl = "",
  goodsTotal,
  discountAmount,
  shippingFee = 0,
  shippingMethod = "",
  shippingTrackingNo = "",
}: {
  documentId: string;
  docDate: string;
  notes: string;
  referenceNo: string;
  paymentChannel?: string | null;
  receivingBankLabel?: string | null;
  storedBankAccountId?: string | null;
  bankAccounts?: ActiveBankAccount[];
  docType?: string;
  salesChannel?: string | null;
  slipUrl?: string;
  goodsTotal: number;
  discountAmount: number;
  shippingFee?: number;
  shippingMethod?: string;
  shippingTrackingNo?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [date, setDate] = useState(docDate.slice(0, 10));
  const [slipNo, setSlipNo] = useState(referenceNo);
  const [remark, setRemark] = useState(notes);
  const cashReceipt = docType === "ABB" || docType === "CS_TAX";
  const initialChannel: PaymentChannel = initialCashReceiptChannel({
    docType: docType ?? "",
    salesChannel,
    storedChannel: paymentChannel,
  });
  const [channel, setChannel] = useState<PaymentChannel>(initialChannel);
  const [bankAccountId, setBankAccountId] = useState<string | null>(() =>
    initialBankAccountId(
      bankAccounts,
      initialChannel,
      storedBankAccountId,
      receivingBankLabel,
    ),
  );
  const [receiptUrl, setReceiptUrl] = useState(slipUrl);
  const [discountText, setDiscountText] = useState(() => discountAmount.toFixed(2));
  const [shippingText, setShippingText] = useState(() => roundMoney(shippingFee).toFixed(2));
  const [carrier, setCarrier] = useState(shippingMethod);
  const goods = roundMoney(goodsTotal);
  const parsedDiscount = discountText.trim() === "" ? 0 : Number(discountText);
  const discountValue = roundMoney(parsedDiscount);
  const discountReady = Number.isFinite(parsedDiscount) && parsedDiscount >= 0;
  const parsedShipping = shippingText.trim() === "" ? 0 : Number(shippingText);
  const shippingValue = roundMoney(parsedShipping);
  const shippingReady = Number.isFinite(parsedShipping) && parsedShipping >= 0;
  const nextNet = roundMoney(
    goods - (discountReady ? discountValue : 0) + (shippingReady ? shippingValue : 0),
  );

  function openDialog() {
    setDate(docDate.slice(0, 10));
    setSlipNo(referenceNo);
    setRemark(notes);
    setDiscountText(roundMoney(discountAmount).toFixed(2));
    setShippingText(roundMoney(shippingFee).toFixed(2));
    setCarrier(shippingMethod);
    setOpen(true);
  }

  function onSave() {
    if (pending) return;
    if (!shippingReady) {
      toast.error("ค่าขนส่งต้องเป็นตัวเลขไม่ติดลบ");
      return;
    }
    if (!discountReady || discountValue - goods > 0.005) {
      toast.error(
        discountValue - goods > 0.005
          ? "ส่วนลดท้ายบิลต้องไม่เกินยอดรวมสินค้า"
          : "ส่วนลดท้ายบิลต้องเป็นตัวเลขไม่ติดลบ",
      );
      return;
    }
    startTransition(async () => {
      const result = await updateSalesDocumentDirect({
        document_id: documentId,
        doc_date: date,
        notes: remark.trim() || null,
        reference_no: slipNo.trim() || null,
        payment_channel: channel,
        bank_account_id: selectedBankAccount(bankAccounts, channel, bankAccountId)?.id ?? null,
        receiving_bank_label: (() => {
          const account = selectedBankAccount(bankAccounts, channel, bankAccountId);
          return account ? bankAccountDisplay(account) : paymentChannelLabel(channel);
        })(),
        slip_url: receiptUrl.trim() || null,
        discount_amount: discountValue,
        shipping_fee: shippingValue,
        shipping_method: carrier || null,
        shipping_tracking_no: shippingTrackingNo.trim() || null,
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
        onClick={openDialog}
      >
        <Pencil className="size-4" />
        ✏️ แก้ไขข้อมูลหัวบิล / วันที่ / หมายเหตุ
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>แก้ไขหัวบิลที่ออกแล้ว</DialogTitle>
            <DialogDescription>
              ปรับวันที่ เลขสลิป ส่วนลดท้ายบิล ช่องทางรับเงิน และหมายเหตุโดยไม่ยกเลิกเอกสาร
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
            {cashReceipt ? (
              <CashReceiptPaymentBox
                channel={channel}
                bankAccountId={bankAccountId}
                accounts={bankAccounts}
                referenceNo={slipNo}
                slipUrl={receiptUrl}
                disabled={pending}
                onChannelChange={(next, accountId) => {
                  setChannel(next);
                  setBankAccountId(accountId);
                }}
                onReferenceChange={setSlipNo}
                onSlipUrlChange={setReceiptUrl}
                onSlipDate={setDate}
              />
            ) : (
              <PaymentChannelPicker
                value={channel}
                bankAccountId={bankAccountId}
                accounts={bankAccounts}
                disabled={pending}
                onChange={(next, accountId) => {
                  setChannel(next);
                  setBankAccountId(accountId);
                }}
              />
            )}
            <div className="space-y-1.5">
              <Label htmlFor="issued-discount-amount">ส่วนลดท้ายบิล (บาท)</Label>
              <Input
                id="issued-discount-amount"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                value={discountText}
                disabled={pending}
                onChange={(event) => setDiscountText(event.target.value)}
              />
              <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
                ยอดรวมสินค้า {money(goods)} − ส่วนลด {money(discountReady ? discountValue : 0)} +
                ค่าขนส่ง {money(shippingReady ? shippingValue : 0)} (ไม่คิด VAT) ={" "}
                <span className="font-semibold text-slate-900">ยอดสุทธิใหม่ {money(nextNet)}</span>
              </p>
            </div>
            <SalesShippingFields
              fee={shippingText}
              method={carrier}
              disabled={pending}
              feeId="issued-shipping-fee"
              methodId="issued-shipping-method"
              onFeeChange={setShippingText}
              onMethodChange={setCarrier}
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
