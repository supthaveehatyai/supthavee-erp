"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { receiveSalesDocumentPayment } from "@/lib/actions/finance/payment";
import { parseTransferSlipOcr } from "@/lib/actions/sales-ocr-actions";
import { PaymentChannelPicker } from "@/components/finance/payment-channel-picker";
import {
  bankAccountDisplay,
  initialBankAccountId,
  paymentChannelLabel,
  resolveSlipBankAccount,
  selectedBankAccount,
  type ActiveBankAccount,
  type PaymentChannel,
} from "@/lib/finance/payment-channel";
import { formatBuddhistSlash } from "@/lib/utils/deposit-note";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function roundMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function ReceivePaymentDialog({
  documentId,
  docNo,
  grandTotal,
  depositDeducted,
  paidAmount,
  amountDue,
  bankAccounts = [],
}: {
  documentId: string;
  docNo: string;
  grandTotal: number;
  depositDeducted: number;
  paidAmount: number;
  amountDue: number;
  bankAccounts?: ActiveBankAccount[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [paymentDate, setPaymentDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [amount, setAmount] = useState(amountDue.toFixed(2));
  const [paymentChannel, setPaymentChannel] = useState<PaymentChannel>("COMPANY_BANK");
  const [bankAccountId, setBankAccountId] = useState<string | null>(() =>
    initialBankAccountId(bankAccounts, "COMPANY_BANK"),
  );
  const [whtRate, setWhtRate] = useState<"0" | "1" | "3">("0");
  const [referenceNo, setReferenceNo] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [isReadingSlip, setIsReadingSlip] = useState(false);
  const [isPending, startTransition] = useTransition();

  const settle = roundMoney(Number(amount));
  const wht = roundMoney((settle * Number(whtRate)) / 100);
  const cash = roundMoney(Math.max(0, settle - wht));

  async function readSlip(file: File | null) {
    if (!file || file.size <= 0) {
      setSlipFile(null);
      return;
    }
    setSlipFile(file);
    setIsReadingSlip(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const result = await parseTransferSlipOcr(formData);
      if (result.error || !result.data) {
        toast.error(result.error ?? "อ่านสลิปไม่สำเร็จ");
        return;
      }
      if (result.data.doc_date) {
        setPaymentDate(result.data.doc_date);
        toast.success(
          `ดึงวันที่โอนจากสลิป: ${formatBuddhistSlash(result.data.doc_date)} อัตโนมัติ`,
        );
      }
      if (result.data.reference_no) setReferenceNo(result.data.reference_no);
      const payee = resolveSlipBankAccount(
        bankAccounts,
        result.data.payee_name,
        result.data.payee_account,
      );
      if (payee) {
        setPaymentChannel(payee.channel);
        setBankAccountId(
          payee.bankAccountId ?? initialBankAccountId(bankAccounts, payee.channel),
        );
        toast.message(payee.notice);
      }
    } finally {
      setIsReadingSlip(false);
    }
  }

  function handleSubmit() {
    if (!(settle > 0)) {
      toast.error("กรุณาระบุยอดที่รับชำระ");
      return;
    }
    const formData = new FormData();
    formData.set("document_id", documentId);
    formData.set("payment_date", paymentDate);
    formData.set("amount", settle.toFixed(2));
    formData.set("wht_rate", whtRate);
    formData.set("reference_no", referenceNo.trim());
    const account = selectedBankAccount(bankAccounts, paymentChannel, bankAccountId);
    formData.set("payment_channel", paymentChannel);
    formData.set("bank_account_id", account?.id ?? "");
    formData.set(
      "receiving_bank_label",
      account ? bankAccountDisplay(account) : paymentChannelLabel(paymentChannel),
    );
    if (slipFile) formData.set("slip_file", slipFile);

    startTransition(async () => {
      const result = await receiveSalesDocumentPayment(formData);
      if (!result.success) {
        toast.error(result.error ?? "รับชำระไม่สำเร็จ");
        return;
      }
      toast.success(`บันทึกการรับชำระ ${docNo} แล้ว`);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        type="button"
        className="h-10 gap-2 bg-emerald-600 font-semibold text-white hover:bg-emerald-700"
        onClick={() => {
          setAmount(amountDue.toFixed(2));
          setOpen(true);
        }}
      >
        <Wallet className="size-4" />
        💵 รับชำระเงิน / ตัดยอดบิลนี้
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>รับชำระเงิน {docNo}</DialogTitle>
            <DialogDescription>
              ตัดยอดบนเอกสารขายทันที และปรับสถานะเป็น PAID หรือ PARTIAL
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p>ยอดสุทธิ {formatMoney(grandTotal)} ฿</p>
              <p>หักเงินมัดจำ / ชำระแล้ว {formatMoney(depositDeducted + paidAmount)} ฿</p>
              <p className="font-semibold text-emerald-800">
                ยอดคงเหลือที่ต้องชำระ {formatMoney(amountDue)} ฿
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-date">วันที่รับเงิน</Label>
              <Input
                id="receipt-date"
                type="date"
                value={paymentDate}
                onChange={(event) => setPaymentDate(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-amount">ยอดที่ตัดบิลนี้</Label>
              <Input
                id="receipt-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="receipt-wht">หัก ณ ที่จ่าย</Label>
              <select
                id="receipt-wht"
                value={whtRate}
                onChange={(event) => setWhtRate(event.target.value as "0" | "1" | "3")}
                className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
              >
                <option value="0">ไม่หัก ณ ที่จ่าย</option>
                <option value="1">หัก ณ ที่จ่าย 1%</option>
                <option value="3">หัก ณ ที่จ่าย 3%</option>
              </select>
              <p className="text-xs text-slate-500">
                WHT {formatMoney(wht)} ฿ · รับเงินสด/โอน {formatMoney(cash)} ฿
              </p>
            </div>
            <PaymentChannelPicker
              value={paymentChannel}
              bankAccountId={bankAccountId}
              accounts={bankAccounts}
              disabled={isPending}
              onChange={(channel, accountId) => {
                setPaymentChannel(channel);
                setBankAccountId(accountId);
              }}
            />
            <div className="space-y-1.5">
              <Label htmlFor="receipt-ref">เลขที่อ้างอิงสลิป</Label>
              <Input
                id="receipt-ref"
                value={referenceNo}
                onChange={(event) => setReferenceNo(event.target.value)}
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
              <Label htmlFor="receipt-slip">แนบสลิปโอนเงิน</Label>
              <Input
                id="receipt-slip"
                type="file"
                accept="image/jpeg,image/png,image/webp,application/pdf"
                onChange={(event) => {
                  void readSlip(event.target.files?.[0] ?? null);
                }}
              />
              {isReadingSlip ? (
                <p className="text-xs text-slate-500">กำลังอ่านวันที่และเลขสลิป...</p>
              ) : slipFile ? (
                <p className="text-xs text-slate-500">{slipFile.name}</p>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              type="button"
              disabled={isPending || isReadingSlip}
              className="bg-emerald-600 hover:bg-emerald-700"
              onClick={handleSubmit}
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
              ยืนยันรับชำระ
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
