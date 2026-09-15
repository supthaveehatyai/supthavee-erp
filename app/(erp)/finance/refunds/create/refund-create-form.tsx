"use client";

/**
 * Refund create form — client island for Combobox, amounts, bank, slip.
 * Data is server-fetched via URL params (`?type=` `?contact_id=`).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  BanknoteArrowDown,
  FileUp,
  Loader2,
} from "lucide-react";
import { createRefundDocument } from "@/app/actions/refunds";
import { OutstandingPartyCombobox } from "@/components/finance/OutstandingPartyCombobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { PENDING_APPROVAL_TOAST_MESSAGE } from "@/lib/approval/approval-rules";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { compressImage } from "@/lib/utils/image-compression";
import { cn } from "@/lib/utils";
import { roundMoney } from "@/lib/utils/payment-fifo";
import {
  CASH_ACCOUNT_SENTINEL,
  REFUND_AMOUNT_RANGE_MESSAGE,
} from "@/lib/validations/refund";
import type { BankAccount } from "@/types/bank-account";
import type {
  RefundPartyOption,
  RefundSide,
  RefundableDeposit,
} from "@/types/refund";

const MONEY_EPS = 0.02;

export type RefundCreateFormProps = {
  type: RefundSide;
  selectedContactId: string;
  parties: RefundPartyOption[];
  partiesError: string | null;
  deposits: RefundableDeposit[];
  depositsError: string | null;
  bankAccounts: BankAccount[];
  defaultDate: string;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function parseAmount(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return roundMoney(n);
}

function buildRefundHref(type: RefundSide, contactId?: string): string {
  const params = new URLSearchParams();
  params.set("type", type);
  if (contactId?.trim()) params.set("contact_id", contactId.trim());
  return `/finance/refunds/create?${params.toString()}`;
}

export function RefundCreateForm({
  type,
  selectedContactId,
  parties,
  partiesError,
  deposits,
  depositsError,
  bankAccounts,
  defaultDate,
}: RefundCreateFormProps) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [documentDate, setDocumentDate] = useState(defaultDate);
  const [bankAccountId, setBankAccountId] = useState(CASH_ACCOUNT_SENTINEL);
  const [remark, setRemark] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);

  const isAr = type === "AR";
  const accent = isAr ? "blue" : "orange";
  const activeBanks = bankAccounts.filter((row) => row.is_active);

  const selectedLines = useMemo(() => {
    return deposits
      .map((row) => {
        const amount = parseAmount(amounts[row.id] ?? "");
        return { row, amount };
      })
      .filter((item) => item.amount > 0);
  }, [amounts, deposits]);

  const totalRefund = roundMoney(
    selectedLines.reduce((sum, item) => sum + item.amount, 0),
  );

  const overLimitLine = selectedLines.find(
    (item) => item.amount > item.row.remaining_balance + MONEY_EPS,
  );

  function handleContactChange(contactId: string) {
    router.push(buildRefundHref(type, contactId));
  }

  function handleAmountChange(depositId: string, raw: string) {
    setFieldError(null);
    setAmounts((prev) => ({ ...prev, [depositId]: raw }));
  }

  function fillRemaining(row: RefundableDeposit) {
    setFieldError(null);
    setAmounts((prev) => ({
      ...prev,
      [row.id]: row.remaining_balance.toFixed(2),
    }));
  }

  async function handleSlipChange(fileList: FileList | null) {
    const file = fileList?.[0] ?? null;
    if (!file) {
      setSlipFile(null);
      return;
    }
    const mime = (file.type || "").toLowerCase();
    const allowed =
      mime.startsWith("image/") || mime === "application/pdf" || !mime;
    if (!allowed) {
      toast.error("แนบได้เฉพาะไฟล์รูปภาพ หรือ PDF");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("ไฟล์สลิปใหญ่เกิน 10MB");
      return;
    }
    if (mime.startsWith("image/")) {
      try {
        const compressed = await compressImage(file);
        setSlipFile(compressed);
      } catch (err) {
        toast.error(
          err instanceof Error
            ? `บีบอัดสลิปไม่สำเร็จ: ${err.message}`
            : "บีบอัดสลิปไม่สำเร็จ",
        );
        setSlipFile(null);
      }
      return;
    }
    setSlipFile(file);
  }

  async function handleSubmit() {
    setFieldError(null);
    if (!selectedContactId) {
      setFieldError("กรุณาเลือกคู่ค้า");
      return;
    }
    if (!bankAccountId) {
      setFieldError("กรุณาเลือกช่องทางรับ/จ่ายเงิน");
      return;
    }
    if (selectedLines.length === 0) {
      setFieldError("กรุณาระบุยอดคืนเงินอย่างน้อย 1 ใบมัดจำ");
      return;
    }
    if (overLimitLine) {
      setFieldError(
        `${overLimitLine.row.doc_no}: ${REFUND_AMOUNT_RANGE_MESSAGE}`,
      );
      return;
    }

    setIsSubmitting(true);
    try {
      const createdNos: string[] = [];
      let pendingApproval = false;

      for (const item of selectedLines) {
        const formData = new FormData();
        formData.set("type", type);
        formData.set("contact_id", selectedContactId);
        formData.set("deposit_id", item.row.id);
        formData.set("amount", String(item.amount));
        formData.set("bank_account_id", bankAccountId);
        formData.set("document_date", documentDate);
        if (remark.trim()) formData.set("remark", remark.trim());
        if (slipFile) formData.set("slip_file", slipFile);

        const result = await createRefundDocument(formData);
        if (!result.success) {
          toast.error(
            createdNos.length > 0
              ? `บันทึกแล้ว ${createdNos.join(", ")} แต่รายการถัดไปล้มเหลว: ${result.error}`
              : (result.error ?? "บันทึกใบคืนเงินมัดจำไม่สำเร็จ"),
          );
          return;
        }
        if (result.data?.document_no) {
          createdNos.push(result.data.document_no);
        }
        if (result.data?.pending_approval) pendingApproval = true;
      }

      if (pendingApproval) {
        toast.success(PENDING_APPROVAL_TOAST_MESSAGE);
      } else {
        toast.success(
          createdNos.length === 1
            ? `บันทึกใบคืนเงินมัดจำสำเร็จ — ${createdNos[0]}`
            : `บันทึกใบคืนเงินมัดจำสำเร็จ ${createdNos.length} ใบ — ${createdNos.join(", ")}`,
        );
      }

      setAmounts({});
      setSlipFile(null);
      router.push(buildRefundHref(type, selectedContactId));
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "บันทึกใบคืนเงินมัดจำไม่สำเร็จ",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <BanknoteArrowDown
              className={cn("h-8 w-8", isAr ? "text-blue-600" : "text-orange-600")}
            />
            คืนเงินมัดจำ (Refund)
          </h1>
          <p className="text-slate-500">
            ออกเอกสาร {isAr ? "AR_REFUND" : "AP_REFUND"} จากมัดจำคงเหลือ ·
            ประเภทและคู่ค้าผูกกับ URL
          </p>
        </div>
        <Link
          href="/finance/deposits"
          className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" />
          กลับหน้ารายการมัดจำ
        </Link>
      </div>

      <div
        role="tablist"
        className="inline-flex h-10 w-full max-w-xl items-center justify-center rounded-xl bg-slate-100 p-1 text-slate-600"
      >
        <Link
          role="tab"
          aria-selected={isAr}
          href={buildRefundHref("AR")}
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            isAr
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          คืนลูกค้า (AR_REFUND)
        </Link>
        <Link
          role="tab"
          aria-selected={!isAr}
          href={buildRefundHref("AP")}
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            !isAr
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          รับคืนจากซัพพลายเออร์ (AP_REFUND)
        </Link>
      </div>

      {partiesError ? (
        <Alert variant="destructive">
          <AlertTitle>โหลดรายชื่อคู่ค้าไม่สำเร็จ</AlertTitle>
          <AlertDescription>{partiesError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>1. เลือกคู่ค้า (Smart Combobox)</CardTitle>
          <CardDescription>
            แสดงเฉพาะคู่ค้าที่มียอดมัดจำคงเหลือ · ผูกสถานะกับ URL (`?contact_id=`)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-w-xl space-y-2">
            <Label>{isAr ? "ลูกค้า (Customer)" : "ซัพพลายเออร์ (Vendor)"}</Label>
            <OutstandingPartyCombobox
              options={parties}
              value={selectedContactId}
              onChange={handleContactChange}
              accent={accent}
              amountLabel="มัดจำคงเหลือ"
              countLabel="ใบ"
              placeholder={
                isAr
                  ? "ค้นหาลูกค้าที่มียอดมัดจำคงเหลือ..."
                  : "ค้นหาซัพพลายเออร์ที่มียอดมัดจำคงเหลือ..."
              }
              searchPlaceholder="พิมพ์ชื่อคู่ค้า..."
              emptyMessage="ไม่มีคู่ค้าที่มียอดมัดจำคงเหลือ"
              disabled={isSubmitting}
            />
          </div>
        </CardContent>
      </Card>

      {!selectedContactId ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-slate-500">
            เลือกคู่ค้าเพื่อดึงตารางมัดจำคงเหลือ
          </CardContent>
        </Card>
      ) : (
        <>
          {depositsError ? (
            <Alert variant="destructive">
              <AlertTitle>โหลดมัดจำคงเหลือไม่สำเร็จ</AlertTitle>
              <AlertDescription>{depositsError}</AlertDescription>
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>2. มัดจำคงเหลือ (Available Deposits)</CardTitle>
              <CardDescription>
                กรอกยอดคืนเงินต่อใบ · ต้องไม่เกินยอดคงเหลือ · สืบทอด VAT จากบิลต้นทาง
              </CardDescription>
            </CardHeader>
            <CardContent>
              {deposits.length === 0 ? (
                <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
                  ไม่พบมัดจำคงเหลือของคู่ค้ารายนี้
                </div>
              ) : (
                <div className="overflow-hidden rounded-md border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-slate-50">
                        <TableHead>เลขที่บิล</TableHead>
                        <TableHead>วันที่</TableHead>
                        <TableHead className="text-right">
                          ยอดมัดจำคงเหลือ
                        </TableHead>
                        <TableHead className="text-right">อัตราภาษี</TableHead>
                        <TableHead className="text-right">
                          ยอดที่ต้องการคืนเงิน
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {deposits.map((row) => {
                        const raw = amounts[row.id] ?? "";
                        const amount = parseAmount(raw);
                        const overLimit =
                          amount > row.remaining_balance + MONEY_EPS;
                        const docHref = isAr
                          ? `/sales/${encodeURIComponent(row.doc_no)}`
                          : `/purchases/${encodeURIComponent(row.doc_no)}`;
                        return (
                          <TableRow key={row.id}>
                            <TableCell>
                              <div className="flex flex-col gap-1">
                                <a
                                  href={docHref}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={cn(
                                    "font-medium underline-offset-2 hover:underline",
                                    isAr ? "text-blue-700" : "text-orange-700",
                                  )}
                                >
                                  {row.doc_no}
                                </a>
                                <Badge variant="slate" className="w-fit">
                                  {row.doc_type}
                                </Badge>
                              </div>
                            </TableCell>
                            <TableCell>
                              {row.document_date
                                ? formatThaiDate(row.document_date, "short")
                                : "—"}
                            </TableCell>
                            <TableCell className="text-right font-semibold tabular-nums text-red-600">
                              {formatMoney(row.remaining_balance)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-slate-600">
                              {row.vat_type === "NONE" || row.vat_rate <= 0
                                ? "ไม่มี VAT"
                                : `${row.vat_rate}% (${row.vat_type})`}
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex flex-col items-end gap-1">
                                <Input
                                  type="number"
                                  inputMode="decimal"
                                  min={0}
                                  step="0.01"
                                  max={row.remaining_balance}
                                  value={raw}
                                  disabled={isSubmitting}
                                  onChange={(e) =>
                                    handleAmountChange(row.id, e.target.value)
                                  }
                                  className={cn(
                                    "h-9 w-36 text-right tabular-nums",
                                    overLimit &&
                                      "border-red-400 focus:border-red-500 focus:ring-red-100",
                                  )}
                                  placeholder="0.00"
                                />
                                <button
                                  type="button"
                                  className="text-xs font-medium text-slate-500 underline-offset-2 hover:underline"
                                  disabled={isSubmitting}
                                  onClick={() => fillRemaining(row)}
                                >
                                  คืนเต็มจำนวน
                                </button>
                                {overLimit ? (
                                  <p className="max-w-40 text-xs text-red-600">
                                    {REFUND_AMOUNT_RANGE_MESSAGE}
                                  </p>
                                ) : null}
                              </div>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3. ช่องทางรับ/จ่ายเงิน</CardTitle>
              <CardDescription>
                บังคับเลือกบัญชีบริษัท (`mst_bank_accounts`) หรือเงินสด · สลิปไม่บังคับ
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="document_date">
                    วันที่เอกสาร <span className="text-red-500">*</span>
                  </Label>
                  <Input
                    id="document_date"
                    type="date"
                    value={documentDate}
                    disabled={isSubmitting}
                    onChange={(e) => setDocumentDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="bank_account_id">
                    ช่องทางรับ/จ่ายเงิน <span className="text-red-500">*</span>
                  </Label>
                  <select
                    id="bank_account_id"
                    required
                    value={bankAccountId}
                    disabled={isSubmitting}
                    onChange={(e) => setBankAccountId(e.target.value)}
                    className={cn(
                      "flex h-10 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none",
                      isAr
                        ? "focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20"
                        : "focus-visible:border-orange-500 focus-visible:ring-2 focus-visible:ring-orange-500/20",
                    )}
                  >
                    <option value={CASH_ACCOUNT_SENTINEL}>เงินสด (Cash)</option>
                    {activeBanks.map((bank) => (
                      <option key={bank.id} value={bank.id}>
                        {bank.bank_name} · {bank.account_no}
                        {bank.account_name ? ` · ${bank.account_name}` : ""}
                      </option>
                    ))}
                  </select>
                  {activeBanks.length === 0 ? (
                    <p className="text-xs text-amber-700">
                      ยังไม่มีสมุดบัญชี — ใช้เงินสดได้ หรือไปเพิ่มที่เมนูสมุดบัญชีธนาคาร
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="slip_file">อัปโหลดสลิปโอนเงิน (ไม่บังคับ)</Label>
                <div className="flex flex-col gap-2 rounded-md border border-dashed border-slate-300 bg-slate-50 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3 text-sm text-slate-600">
                    <FileUp
                      className={cn(
                        "mt-0.5 h-5 w-5 shrink-0",
                        isAr ? "text-blue-600" : "text-orange-600",
                      )}
                    />
                    <div>
                      <p className="font-medium text-slate-800">
                        แนบไฟล์รูปภาพ หรือ PDF (สูงสุด 10MB)
                      </p>
                      <p className="text-xs text-slate-500">
                        {slipFile
                          ? `เลือกแล้ว: ${slipFile.name}`
                          : "ยังไม่ได้เลือกไฟล์"}
                      </p>
                    </div>
                  </div>
                  <Input
                    id="slip_file"
                    type="file"
                    accept="image/*,application/pdf"
                    disabled={isSubmitting}
                    className="max-w-xs border-0 bg-transparent shadow-none"
                    onChange={(e) => handleSlipChange(e.target.files)}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="remark">หมายเหตุ</Label>
                <Textarea
                  id="remark"
                  rows={3}
                  value={remark}
                  disabled={isSubmitting}
                  onChange={(e) => setRemark(e.target.value)}
                  placeholder="เหตุผลการคืนเงิน / เลขอ้างอิง"
                />
              </div>
            </CardContent>
          </Card>

          {fieldError ? (
            <Alert variant="destructive">
              <AlertTitle>ไม่สามารถบันทึกได้</AlertTitle>
              <AlertDescription>{fieldError}</AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-slate-600">
              รวมยอดคืนเงิน{" "}
              <span className="font-semibold tabular-nums text-slate-900">
                {formatMoney(totalRefund)}
              </span>{" "}
              บาท จาก {selectedLines.length} ใบ
            </p>
            <Button
              type="button"
              disabled={isSubmitting || deposits.length === 0}
              onClick={() => void handleSubmit()}
              className={cn(
                "h-11 min-w-48",
                isAr
                  ? "bg-blue-600 hover:bg-blue-700"
                  : "bg-orange-600 hover:bg-orange-700",
              )}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  กำลังบันทึก...
                </>
              ) : (
                "ยืนยันคืนเงินมัดจำ"
              )}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
