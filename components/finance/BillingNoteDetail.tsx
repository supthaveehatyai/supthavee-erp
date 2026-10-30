"use client";

/**
 * Billing Note detail — screen chrome only.
 * Print document rendered by BillingNotePrintTemplate (Server Component).
 */

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import { toast } from "sonner";
import type { BillingNoteDetailData, BillingNoteSettlement } from "@/types/billing";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { paymentTimeLabel } from "@/lib/utils/payment-timestamp";
import { LinePaymentSlipDialog } from "@/components/finance/line-payment-slip-dialog";
import {
  DeleteBillingNoteButton,
  EditBillingNoteButton,
} from "@/components/finance/billing-note-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type BillingNoteDetailProps = {
  document: BillingNoteDetailData;
  settlements?: BillingNoteSettlement[];
};

function formatDateShort(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function statusBadge(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "PAID" || normalized === "COMPLETED") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
        {status}
      </Badge>
    );
  }
  if (normalized === "PARTIAL") {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
        {status}
      </Badge>
    );
  }
  if (normalized === "PENDING" || normalized === "UNPAID") {
    return (
      <Badge className="border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-50">
        {status}
      </Badge>
    );
  }
  return (
    <Badge className="border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-50">
      {status || "—"}
    </Badge>
  );
}

export function BillingNoteDetail({
  document: doc,
  settlements = [],
}: BillingNoteDetailProps) {
  const isBN = doc.doc_type === "BN";
  const isTB = doc.doc_type === "TB";
  const titleTh = isTB ? "ใบสรุปวางบิลช่าง" : isBN ? "ใบวางบิล" : "ใบรับวางบิล";
  const titleEn = isTB ? "Technician Bill" : isBN ? "Billing Note" : "Bill Receipt";
  const listHref = `/finance/billing-notes?type=${doc.doc_type}`;
  const paymentStatus = doc.payment_status.trim().toUpperCase();
  const canRevise = paymentStatus === "PENDING" || paymentStatus === "UNPAID";
  const awaitingPayment =
    doc.doc_type === "BR" &&
    (paymentStatus === "PENDING" || paymentStatus === "UNPAID" || paymentStatus === "PARTIAL");
  const alreadyPaid =
    (doc.doc_type === "BR" || doc.doc_type === "BN") &&
    (paymentStatus === "PAID" || paymentStatus === "COMPLETED");

  return (
    <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
      <div className="flex flex-col gap-2">
        <Link
          href={listHref}
          className="inline-flex h-9 w-fit items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" />
          กลับรายการวางบิล
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            {doc.doc_no}
          </h1>
          {statusBadge(doc.payment_status)}
          <Badge className="border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-50">
            {doc.doc_type}
          </Badge>
        </div>
        <p className="text-sm text-slate-500">
          {titleTh} ({titleEn}) · วันที่ {formatDateShort(doc.doc_date)}
          {doc.due_date ? ` · ครบกำหนด ${formatDateShort(doc.due_date)}` : null}
          {" · "}
          พิมพ์ A5 แนวนอน
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <div className="flex flex-wrap items-center justify-end gap-2">
          {canRevise ? (
            <>
              <EditBillingNoteButton
                billingNoteId={doc.id}
                docType={doc.doc_type}
                docNo={doc.doc_no}
                docDate={doc.doc_date}
                dueDate={doc.due_date}
                notes={doc.notes}
                contactId={doc.contact?.id ?? ""}
                lines={doc.invoices.map((line) => ({
                  id: line.invoice_id,
                  docNo: line.invoice_doc_no,
                  referenceNo: line.tax_invoice_no || line.reference_no,
                  amount: line.billed_amount,
                }))}
              />
              <DeleteBillingNoteButton
                billingNoteId={doc.id}
                docNo={doc.doc_no}
                docType={doc.doc_type}
                contactId={doc.contact?.id ?? ""}
              />
            </>
          ) : null}
          {awaitingPayment && doc.contact?.id ? (
            <Link
              href={`/finance/ap-payment?vendor_id=${encodeURIComponent(doc.contact.id)}&billing_note_id=${encodeURIComponent(doc.id)}`}
              className="inline-flex h-10 items-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700"
            >
              💸 บันทึกจ่ายเงิน / แนบสลิปโอนเงิน
            </Link>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="h-10 rounded-xl"
            onClick={() => window.print()}
          >
            <Printer className="size-4" />
            พิมพ์เอกสาร
          </Button>
        </div>
        {alreadyPaid ? (
          <PaidSettlementCard
            billingNoteNo={doc.doc_no}
            contactId={doc.contact?.id ?? ""}
            contactName={doc.contact?.company_name ?? "คู่ค้า"}
            invoiceNos={doc.invoices.map((line) => line.invoice_doc_no).filter(Boolean)}
            settlements={settlements}
          />
        ) : null}
      </div>
    </div>
  );
}

function paidWhen(value: string | null): string {
  if (!value) return "—";
  const dateLabel = formatThaiDate(value, "short");
  const timeLabel = paymentTimeLabel(value);
  return timeLabel && timeLabel !== "00:00" ? `${dateLabel} ${timeLabel}` : dateLabel;
}

function transferMessage(
  billingNoteNo: string,
  contactName: string,
  invoiceNos: string[],
  payment: BillingNoteSettlement,
): string {
  const lines = [
    `เรียน ${contactName}`,
    "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด ขอแจ้งโอนเงินตามใบวางบิล",
    `ใบวางบิล: ${billingNoteNo}`,
    invoiceNos.length > 0 ? `รายการบิลที่ชำระ: ${invoiceNos.join(", ")}` : null,
    `ใบสำคัญจ่าย: ${payment.doc_no}`,
    `วันที่โอน: ${paidWhen(payment.paid_at)}`,
    `ธนาคาร/ช่องทาง: ${payment.channel_label}`,
    payment.reference_no ? `เลขอ้างอิงสลิป: ${payment.reference_no}` : null,
    `ยอดโอนสุทธิ: ${payment.amount.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} บาท`,
  ];
  return lines.filter(Boolean).join("\n");
}

function PaidSettlementCard({
  billingNoteNo,
  contactId,
  contactName,
  invoiceNos,
  settlements,
}: {
  billingNoteNo: string;
  contactId: string;
  contactName: string;
  invoiceNos: string[];
  settlements: BillingNoteSettlement[];
}) {
  const [linePayment, setLinePayment] = useState<BillingNoteSettlement | null>(null);

  async function copyMessage(payment: BillingNoteSettlement) {
    try {
      await navigator.clipboard.writeText(transferMessage(billingNoteNo, contactName, invoiceNos, payment));
      toast.success("คัดลอกข้อความแจ้งโอนแล้ว");
    } catch {
      toast.error("คัดลอกข้อความไม่สำเร็จ");
    }
  }

  return (
    <div className="max-w-md rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
      <div className="font-semibold">✅ จ่ายชำระแล้ว (PAID)</div>
      {settlements.length === 0 ? (
        <p className="mt-1 text-xs">ยังไม่พบใบสำคัญจ่ายที่ผูกกับบิลในใบวางบิลนี้</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {settlements.map((payment) => (
            <li key={payment.doc_no} className="space-y-1 border-t border-emerald-200 pt-2 first:border-t-0 first:pt-0">
              <div className="font-mono text-xs font-semibold">{payment.doc_no}</div>
              <div className="text-xs">วันที่โอน: {paidWhen(payment.paid_at)}</div>
              <div className="text-xs">ช่องทาง: {payment.channel_label}</div>
              <div className="text-xs">รหัสอ้างอิงสลิป: {payment.reference_no || "—"}</div>
              <div className="flex flex-wrap gap-2 pt-1">
                {payment.slip_urls[0] ? (
                  <a
                    href={payment.slip_urls[0]}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-8 items-center rounded-lg bg-white px-2 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200"
                  >
                    🖼️ ดูรูปสลิปโอนเงิน
                  </a>
                ) : null}
                <button
                  type="button"
                  onClick={() => setLinePayment(payment)}
                  className="inline-flex h-8 items-center rounded-lg bg-white px-2 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200"
                >
                  📲 ส่งสลิปแจ้งคู่ค้าทาง LINE
                </button>
                <button
                  type="button"
                  onClick={() => void copyMessage(payment)}
                  className="inline-flex h-8 items-center rounded-lg bg-white px-2 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200"
                >
                  📋 คัดลอกข้อความแจ้งโอน
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <LinePaymentSlipDialog
        open={linePayment != null}
        onOpenChange={(next) => {
          if (!next) setLinePayment(null);
        }}
        contactId={contactId}
        contactName={contactName}
        billingNoteNo={billingNoteNo}
        paymentDocNo={linePayment?.doc_no}
        messageText={
          linePayment
            ? transferMessage(billingNoteNo, contactName, invoiceNos, linePayment)
            : ""
        }
        slipUrl={linePayment?.slip_urls.find((url) => url.startsWith("https://")) ?? null}
      />
    </div>
  );
}
