"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { receiveSalesDocumentPayment } from "@/lib/actions/finance/payment";
import { uploadDocumentImage } from "@/lib/actions/document-actions";
import { parseTransferSlipOcr } from "@/lib/actions/sales-ocr-actions";
import {
  salesWhtAmount,
  salesWhtBase,
  SALES_WHT_RATE_OPTIONS,
} from "@/lib/finance/wht-base";
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

function monthKey(value: string): string {
  return value.trim().slice(0, 7);
}

function isoDate(value: string | null | undefined): string {
  const text = String(value ?? "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

export function ReceivePaymentDialog({
  documentId,
  docNo,
  grandTotal,
  depositDeducted,
  paidAmount,
  amountDue,
  netBeforeVat,
  depositNetDeducted = 0,
  vatRate = 7,
  shippingFee = 0,
  bankAccounts = [],
  docType = "",
  docDate = "",
  lastPaymentDate = null,
  vatAmount = 0,
  roundingDifference = 0,
}: {
  documentId: string;
  docNo: string;
  grandTotal: number;
  depositDeducted: number;
  paidAmount: number;
  amountDue: number;
  netBeforeVat: number;
  depositNetDeducted?: number;
  vatRate?: number;
  shippingFee?: number;
  bankAccounts?: ActiveBankAccount[];
  docType?: string;
  docDate?: string;
  lastPaymentDate?: string | null;
  vatAmount?: number;
  roundingDifference?: number;
}) {
  const router = useRouter();
  const sourceDocDate = isoDate(docDate);
  const defaultPaymentDate = isoDate(lastPaymentDate) || sourceDocDate;
  const [open, setOpen] = useState(false);
  const [paymentDate, setPaymentDate] = useState(
    () => defaultPaymentDate || new Date().toISOString().slice(0, 10),
  );
  const [roundingMode, setRoundingMode] = useState<"auto" | "close" | "partial">(
    "auto",
  );
  const [amount, setAmount] = useState(amountDue.toFixed(2));
  const [paymentChannel, setPaymentChannel] = useState<PaymentChannel>("COMPANY_BANK");
  const [bankAccountId, setBankAccountId] = useState<string | null>(() =>
    initialBankAccountId(bankAccounts, "COMPANY_BANK"),
  );
  const [whtRate, setWhtRate] = useState("0");
  const [whtText, setWhtText] = useState("0.00");
  const [whtEdited, setWhtEdited] = useState(false);
  const [referenceNo, setReferenceNo] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [whtUrl, setWhtUrl] = useState("");
  const [whtFileName, setWhtFileName] = useState("");
  const [isReadingSlip, setIsReadingSlip] = useState(false);
  const [isUploadingWht, setIsUploadingWht] = useState(false);
  const [isPending, startTransition] = useTransition();
  const canIssueReceipt = docType === "TAX_INV" || docType === "INV_DO";
  const [issueReceipt, setIssueReceipt] = useState(docType === "TAX_INV");

  const settle = roundMoney(Number(amount));
  const whtPreview = roundMoney(whtText.trim() === "" ? 0 : Number(whtText));
  const expectedNetPayable = roundMoney(
    Math.max(
      0,
      grandTotal - (docType === "SO" ? depositDeducted : 0) - (Number.isFinite(whtPreview) ? whtPreview : 0),
    ),
  );
  const diff = roundMoney(settle - expectedNetPayable);
  const showSettlementModes = Math.abs(diff) >= 0.005;
  const closeWithRounding =
    roundingMode === "partial"
      ? false
      : roundingMode === "close"
        ? true
        : Math.abs(diff) <= 500;
  const paymentMonthDiffers =
    Boolean(sourceDocDate) &&
    Boolean(paymentDate) &&
    monthKey(paymentDate) !== monthKey(sourceDocDate);
  const whtBase = salesWhtBase({
    payAmount: settle,
    remainingGrand: amountDue,
    grandTotal,
    netBeforeVat,
    depositNetDeducted,
    depositDeducted,
    paidAmount,
    vatRate,
    shippingFee,
  });
  const suggestedWht = salesWhtAmount(whtBase, Number(whtRate));
  const wht = roundMoney(whtText.trim() === "" ? 0 : Number(whtText));
  const roundingDiff = roundMoney(roundingDifference);

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

  function applyWhtRate(nextRate: string) {
    setWhtRate(nextRate);
    setWhtEdited(false);
    setWhtText(salesWhtAmount(whtBase, Number(nextRate)).toFixed(2));
  }

  function applySettleAmount(nextAmount: string) {
    setRoundingMode("auto");
    setAmount(nextAmount);
    if (whtEdited) return;
    const nextSettle = roundMoney(Number(nextAmount));
    const nextBase = salesWhtBase({
      payAmount: nextSettle,
      remainingGrand: amountDue,
      grandTotal,
      netBeforeVat,
      depositNetDeducted,
      depositDeducted,
      paidAmount,
      vatRate,
      shippingFee,
    });
    setWhtText(salesWhtAmount(nextBase, Number(whtRate)).toFixed(2));
  }

  async function uploadWht(file: File | null) {
    if (!file || file.size <= 0) {
      setWhtUrl("");
      setWhtFileName("");
      return;
    }
    setIsUploadingWht(true);
    try {
      const uploadData = new FormData();
      uploadData.set("file", file);
      const uploaded = await uploadDocumentImage(uploadData);
      if (uploaded.error || !uploaded.data?.url) {
        toast.error(uploaded.error ?? "อัปโหลดใบ 50 ทวิไม่สำเร็จ");
        return;
      }
      setWhtUrl(uploaded.data.url);
      setWhtFileName(file.name);
    } finally {
      setIsUploadingWht(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !isPending) setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, isPending]);

  function handleSubmit() {
    if (!(settle > 0)) {
      toast.error("กรุณาระบุยอดที่รับชำระ");
      return;
    }
    if (!Number.isFinite(wht) || wht < 0) {
      toast.error("ยอดภาษีหัก ณ ที่จ่ายไม่ถูกต้อง");
      return;
    }
    if (wht - settle > 0.05) {
      toast.error("ยอดหัก ณ ที่จ่ายเกินยอดที่ตัดบิล");
      return;
    }
    const formData = new FormData();
    formData.set("document_id", documentId);
    formData.set("payment_date", paymentDate);
    formData.set("amount", settle.toFixed(2));
    formData.set("close_with_rounding", closeWithRounding ? "1" : "0");
    formData.set("wht_rate", whtRate);
    formData.set("wht_amount", wht.toFixed(2));
    formData.set("wht_attachment_url", whtUrl);
    formData.set("reference_no", referenceNo.trim());
    const account = selectedBankAccount(bankAccounts, paymentChannel, bankAccountId);
    formData.set("payment_channel", paymentChannel);
    formData.set("bank_account_id", account?.id ?? "");
    formData.set(
      "receiving_bank_label",
      account ? bankAccountDisplay(account) : paymentChannelLabel(paymentChannel),
    );
    if (slipFile) formData.set("slip_file", slipFile);
    if (canIssueReceipt && issueReceipt) formData.set("issue_receipt", "1");

    startTransition(async () => {
      const result = await receiveSalesDocumentPayment(formData);
      if (!result.success) {
        toast.error(result.error ?? "รับชำระไม่สำเร็จ");
        return;
      }
      if (result.receipt_error) {
        toast.error(result.receipt_error);
      }
      const depositNo = result.deposit_doc_no?.trim() || "";
      if (depositNo) {
        toast.success(`ออกใบรับเงินมัดจำ ${depositNo} ตามวันที่รับเงินแล้ว`);
      }
      const receiptNo = result.receipt_doc_no?.trim() || "";
      if (receiptNo) {
        toast.success(`บันทึกการรับชำระและออกใบเสร็จ ${receiptNo} แล้ว`);
        window.location.assign(`/sales/${encodeURIComponent(receiptNo)}`);
        return;
      }
      if (!depositNo) toast.success(`บันทึกการรับชำระ ${docNo} แล้ว`);
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
          const openingWht = roundMoney(whtText.trim() === "" ? 0 : Number(whtText));
          const openingExpected = roundMoney(
            Math.max(
              0,
              grandTotal -
                (docType === "SO" ? depositDeducted : 0) -
                (Number.isFinite(openingWht) ? openingWht : 0),
            ),
          );
          setAmount((openingExpected > 0 ? openingExpected : amountDue).toFixed(2));
          setPaymentDate(defaultPaymentDate || paymentDate);
          setRoundingMode("auto");
          setOpen(true);
        }}
      >
        <Wallet className="size-4" />
        💵 รับชำระเงิน / ตัดยอดบิลนี้
      </Button>
      {open
        ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/50 p-3 sm:p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isPending) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="receive-payment-title"
            className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
          >
            <div className="flex shrink-0 items-center justify-between border-b bg-white px-5 py-3.5">
              <h2 id="receive-payment-title" className="text-base font-semibold text-slate-900">
                รับชำระเงิน {docNo}
              </h2>
              <button
                type="button"
                aria-label="ปิด"
                disabled={isPending}
                onClick={() => setOpen(false)}
                className="grid size-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-5 py-4 text-sm">
            <div className="space-y-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
              <p>ยอดสุทธิ {formatMoney(grandTotal)} ฿</p>
              <p>หักเงินมัดจำ / ชำระแล้ว {formatMoney(depositDeducted + paidAmount)} ฿</p>
              <p className="font-semibold text-emerald-800">
                ยอดคงเหลือที่ต้องชำระ {formatMoney(amountDue)} ฿
              </p>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
                <Label htmlFor="receipt-amount">ยอดที่ตัดบิลนี้ (บาท)</Label>
                <Input
                  id="receipt-amount"
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => applySettleAmount(event.target.value)}
                />
                <p className="text-xs text-slate-500">
                  ยอดคงเหลือที่ต้องชำระสุทธิ {formatMoney(expectedNetPayable)} ฿
                </p>
              </div>
              {paymentMonthDiffers ? (
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-snug text-amber-800 sm:col-span-2">
                  ⚠️ วันที่รับเงินอยู่ในเดือนที่ต่างจากใบสั่งขายต้นทาง ({sourceDocDate}) — เอกสารภาษีที่ออกตามวันที่นี้จะรันเลขในหมวดเดือนของวันที่รับเงิน
                </p>
              ) : null}
              {showSettlementModes ? (
                <div className="space-y-2 sm:col-span-2">
                  <button
                    type="button"
                    onClick={() => setRoundingMode("close")}
                    className={
                      closeWithRounding
                        ? "w-full rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-xs leading-snug text-emerald-900"
                        : "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs leading-snug text-slate-700"
                    }
                  >
                    ✅ ปิดยอดบิลเป็นชำระครบ (PAID) และบันทึกผลต่าง {diff.toFixed(2)} ฿ เป็นค่าใช้จ่ายปัดเศษ / ส่วนลดรับชำระ
                  </button>
                  <button
                    type="button"
                    onClick={() => setRoundingMode("partial")}
                    className={
                      !closeWithRounding
                        ? "w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-left text-xs leading-snug text-amber-900"
                        : "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-left text-xs leading-snug text-slate-700"
                    }
                  >
                    {docType === "SO"
                      ? `🧾 รับชำระบางส่วน (${settle.toFixed(2)} ฿) — ระบบจะออก "ใบรับเงินมัดจำ/ใบกำกับภาษี (DIN)" ยอด ${settle.toFixed(2)} ฿ ให้อัตโนมัติตามวันที่รับเงิน และคงเหลือค้างชำระ ${(expectedNetPayable - settle).toFixed(2)} ฿`
                      : docType === "TAX_INV" || docType === "INV_DO"
                        ? `⏳ รับชำระหนี้บางส่วน (PARTIAL) — คงเหลือค้างชำระ ${(expectedNetPayable - settle).toFixed(2)} ฿`
                        : `⏳ รับชำระบางส่วน — คงเหลือค้างชำระ ${(expectedNetPayable - settle).toFixed(2)} ฿`}
                  </button>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="receipt-wht">หัก ณ ที่จ่าย</Label>
                <select
                  id="receipt-wht"
                  value={whtRate}
                  onChange={(event) => applyWhtRate(event.target.value)}
                  className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm"
                >
                  {SALES_WHT_RATE_OPTIONS.map((rate) => (
                    <option key={rate} value={String(rate)}>
                      {rate === 0 ? "ไม่หัก ณ ที่จ่าย" : `หัก ณ ที่จ่าย ${rate}%`}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="receipt-wht-amount">ยอดภาษีหัก ณ ที่จ่าย (บาท)</Label>
                <Input
                  id="receipt-wht-amount"
                  inputMode="decimal"
                  value={whtText}
                  onChange={(event) => {
                    setWhtEdited(true);
                    setWhtText(event.target.value);
                  }}
                />
              </div>
              <p className="text-xs text-slate-600 sm:col-span-2">
                ฐานก่อน VAT {formatMoney(netBeforeVat)} ฿ · VAT {formatMoney(vatAmount)} ฿
                {roundingDiff !== 0 ? ` · ปัดเศษ ${roundingDiff.toFixed(2)} ฿` : ""} · หัก ณ ที่จ่าย ={" "}
                {formatMoney(Number.isFinite(wht) ? wht : suggestedWht)} ฿ · ยอดโอนเข้าบัญชีจริง ={" "}
                {formatMoney(settle)} ฿
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
            {Number(whtRate) > 0 || wht > 0.005 ? (
              <div
                className="space-y-1.5"
                onDragOver={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  void uploadWht(event.dataTransfer.files?.[0] ?? null);
                }}
              >
                <Label htmlFor="receipt-wht-file">
                  📄 แนบหนังสือรับรองหัก ณ ที่จ่าย (50 ทวิ) — แนบตอนนี้หรือแนบภายหลังได้
                </Label>
                <Input
                  id="receipt-wht-file"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => {
                    void uploadWht(event.target.files?.[0] ?? null);
                  }}
                />
                {isUploadingWht ? (
                  <p className="text-xs text-slate-500">กำลังอัปโหลดใบ 50 ทวิ...</p>
                ) : whtFileName ? (
                  <p className="text-xs text-slate-500">{whtFileName}</p>
                ) : null}
              </div>
            ) : null}
            {canIssueReceipt ? (
              <label className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-950">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={issueReceipt}
                  disabled={isPending}
                  onChange={(event) => setIssueReceipt(event.target.checked)}
                />
                <span>ออกใบเสร็จรับเงิน (REC) อัตโนมัติทันทีหลังบันทึกการรับชำระเงิน</span>
              </label>
            ) : null}
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t bg-slate-50 px-5 py-3">
              <Button
                type="button"
                variant="outline"
                disabled={isPending}
                onClick={() => setOpen(false)}
              >
                ยกเลิก
              </Button>
              <Button
                type="button"
                disabled={isPending || isReadingSlip || isUploadingWht}
                className="bg-emerald-600 hover:bg-emerald-700"
                onClick={handleSubmit}
              >
                {isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                ยืนยันรับชำระ
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
