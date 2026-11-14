"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { PaymentChannelPicker } from "@/components/finance/payment-channel-picker";
import { CashReceiptPaymentBox } from "@/components/sales/cash-receipt-payment-box";
import { updateSalesDocumentDirect } from "@/lib/actions/document-actions";
import {
  bankAccountDisplay,
  CASH_RECEIPT_LABEL,
  initialBankAccountId,
  initialCashReceiptChannel,
  paymentChannelLabel,
  selectedBankAccount,
  type ActiveBankAccount,
  type PaymentChannel,
} from "@/lib/finance/payment-channel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SalesShippingFields } from "@/components/sales/sales-shipping-fields";
import {
  isVatCalculationType,
  salesPayableTotals,
} from "@/lib/utils/document-summary";

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function documentMonthKey(value: string): string {
  return value.trim().slice(0, 7);
}

export function SalesHeaderEditDialog({
  documentId,
  docNo,
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
  depositDeducted = 0,
  vatType = "INCLUSIVE",
  pricesIncludeVat = false,
  roundingDifference = 0,
}: {
  documentId: string;
  docNo: string;
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
  depositDeducted?: number;
  vatType?: string | null;
  /** ราคารายการรวม VAT แล้ว — ใบกำกับเต็มรูปแค่แยกฐานภาษี ไม่บวก 7% ซ้ำ */
  pricesIncludeVat?: boolean;
  roundingDifference?: number;
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
    initialChannel === "CASH"
      ? null
      : initialBankAccountId(
          bankAccounts,
          initialChannel,
          storedBankAccountId,
          receivingBankLabel,
        ),
  );
  const [receivingLabel, setReceivingLabel] = useState(() =>
    initialChannel === "CASH"
      ? CASH_RECEIPT_LABEL
      : receivingBankLabel?.trim() || paymentChannelLabel(initialChannel),
  );
  const [receiptUrl, setReceiptUrl] = useState(slipUrl);
  const [discountText, setDiscountText] = useState(() => discountAmount.toFixed(2));
  const [roundingText, setRoundingText] = useState(() =>
    roundMoney(roundingDifference).toFixed(2),
  );
  const [shippingText, setShippingText] = useState(() => roundMoney(shippingFee).toFixed(2));
  const [carrier, setCarrier] = useState(shippingMethod);
  const goods = roundMoney(goodsTotal);
  const parsedDiscount = discountText.trim() === "" ? 0 : Number(discountText);
  const discountValue = roundMoney(parsedDiscount);
  const discountReady = Number.isFinite(parsedDiscount) && parsedDiscount >= 0;
  const parsedShipping = shippingText.trim() === "" ? 0 : Number(shippingText);
  const shippingValue = roundMoney(parsedShipping);
  const shippingReady = Number.isFinite(parsedShipping) && parsedShipping >= 0;
  const storedVatMode = isVatCalculationType(String(vatType ?? ""))
    ? String(vatType)
    : "INCLUSIVE";
  const vatMode = pricesIncludeVat ? "INCLUSIVE" : storedVatMode;
  const preview = salesPayableTotals({
    goodsSubtotal: goods,
    discountAmount: discountReady ? discountValue : 0,
    depositDeducted,
    vatType: vatMode as "INCLUSIVE" | "EXCLUSIVE" | "NONE",
    shippingFee: shippingReady ? shippingValue : 0,
  });

  function applyChannel(next: PaymentChannel, accountId: string | null) {
    if (next === "CASH") {
      setChannel("CASH");
      setBankAccountId(null);
      setReceivingLabel(CASH_RECEIPT_LABEL);
      return;
    }
    setChannel(next);
    setBankAccountId(accountId);
    const account = selectedBankAccount(bankAccounts, next, accountId);
    setReceivingLabel(
      account ? bankAccountDisplay(account) : paymentChannelLabel(next),
    );
  }

  function openDialog() {
    const nextChannel = initialCashReceiptChannel({
      docType: docType ?? "",
      salesChannel,
      storedChannel: paymentChannel,
    });
    setDate(docDate.slice(0, 10));
    setSlipNo(referenceNo);
    setRemark(notes);
    setDiscountText(roundMoney(discountAmount).toFixed(2));
    setRoundingText(roundMoney(roundingDifference).toFixed(2));
    setShippingText(roundMoney(shippingFee).toFixed(2));
    setCarrier(shippingMethod);
    setChannel(nextChannel);
    setBankAccountId(
      nextChannel === "CASH"
        ? null
        : initialBankAccountId(
            bankAccounts,
            nextChannel,
            storedBankAccountId,
            receivingBankLabel,
          ),
    );
    setReceivingLabel(
      nextChannel === "CASH"
        ? CASH_RECEIPT_LABEL
        : receivingBankLabel?.trim() || paymentChannelLabel(nextChannel),
    );
    setReceiptUrl(slipUrl);
    setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pending) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, pending]);

  function onSave() {
    if (pending) return;
    if (!shippingReady) {
      toast.error("ค่าขนส่งต้องเป็นตัวเลขไม่ติดลบ");
      return;
    }
    const parsedRounding = roundingText.trim() === "" ? 0 : Number(roundingText);
    if (!Number.isFinite(parsedRounding)) {
      toast.error("ปัดเศษ / ส่วนลดรับชำระต้องเป็นตัวเลข");
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
    const cashReceipt = channel === "CASH";
    const account = cashReceipt
      ? null
      : selectedBankAccount(bankAccounts, channel, bankAccountId);
    startTransition(async () => {
      const result = await updateSalesDocumentDirect({
        document_id: documentId,
        doc_date: date,
        notes: remark.trim() || null,
        reference_no: slipNo.trim() || null,
        payment_channel: cashReceipt ? "CASH" : channel,
        bank_account_id: cashReceipt ? null : (account?.id ?? null),
        receiving_bank_label: cashReceipt
          ? CASH_RECEIPT_LABEL
          : account
            ? bankAccountDisplay(account)
            : receivingLabel,
        slip_url: receiptUrl.trim() || null,
        discount_amount: discountValue,
        shipping_fee: shippingValue,
        shipping_method: carrier || null,
        shipping_tracking_no: shippingTrackingNo.trim() || null,
        rounding_difference: roundMoney(parsedRounding),
      });
      if (result.error || !result.data) {
        toast.error(result.error ?? "แก้ไขหัวบิลไม่สำเร็จ");
        return;
      }
      const nextDocNo = result.data.doc_no?.trim() || result.data.document_no?.trim() || "";
      toast.success(
        nextDocNo && nextDocNo !== docNo
          ? `บันทึกหัวบิลแล้ว — เลขที่เอกสารใหม่ ${nextDocNo}`
          : "บันทึกหัวบิลแล้ว",
      );
      setOpen(false);
      if (nextDocNo && nextDocNo !== docNo) {
        router.replace(`/sales/${encodeURIComponent(nextDocNo)}`);
        return;
      }
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
      {open
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !pending) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="issued-header-title"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b bg-white px-5 py-3.5">
              <h2 id="issued-header-title" className="text-base font-semibold text-slate-900">
                แก้ไขหัวบิลที่ออกแล้ว
              </h2>
              <button
                type="button"
                aria-label="ปิด"
                disabled={pending}
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="issued-doc-date">วันที่เอกสาร</Label>
              <Input
                id="issued-doc-date"
                type="date"
                value={date}
                disabled={pending}
                onChange={(event) => setDate(event.target.value)}
              />
              {documentMonthKey(date) !== documentMonthKey(docDate) ? (
                <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-medium text-sky-800">
                  ℹ️ การเปลี่ยนวันที่ข้ามเดือน ระบบจะรันเลขที่เอกสารใหม่ให้ตรงกับงวดเดือนของวันที่เลือกโดยอัตโนมัติ
                </p>
              ) : null}
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
                onChannelChange={applyChannel}
                onReferenceChange={setSlipNo}
                onSlipUrlChange={setReceiptUrl}
                onSlipDate={setDate}
                hideReferenceField
              />
            ) : (
              <PaymentChannelPicker
                value={channel}
                bankAccountId={bankAccountId}
                accounts={bankAccounts}
                disabled={pending}
                onChange={applyChannel}
              />
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="issued-rounding-difference">
                  ปัดเศษ / ส่วนลดรับชำระ (บาท)
                </Label>
                <Input
                  id="issued-rounding-difference"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={roundingText}
                  disabled={pending}
                  onChange={(event) => setRoundingText(event.target.value)}
                />
              </div>
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
              </div>
              <SalesShippingFields
                fee={shippingText}
                method={carrier}
                disabled={pending}
                feeId="issued-shipping-fee"
                methodId="issued-shipping-method"
                showMethod={false}
                onFeeChange={setShippingText}
                onMethodChange={setCarrier}
              />
            </div>
            <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700">
              ค่าสินค้า {money(goods)} ฿
              {preview.discount_amount > 0
                ? ` - ส่วนลด ${money(preview.discount_amount)} ฿`
                : ""}
              {" "}- หักมัดจำ {money(preview.deposit_deducted)} ฿
              {vatMode === "EXCLUSIVE"
                ? ` + ภาษีมูลค่าเพิ่ม ${money(preview.vat_amount)} ฿`
                : ""}
              {" "}+ ค่าขนส่ง {money(preview.shipping_fee)} ฿ ={" "}
              <span className="font-semibold text-slate-900">
                ยอดเรียกเก็บสุทธิ {money(preview.grand_total)} ฿
              </span>
            </p>
            <SalesShippingFields
              fee={shippingText}
              method={carrier}
              disabled={pending}
              feeId="issued-shipping-fee-method"
              methodId="issued-shipping-method"
              showFee={false}
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
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-slate-50 px-5 py-3">
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
        </div>,
        document.body,
      )
        : null}
    </>
  );
}
