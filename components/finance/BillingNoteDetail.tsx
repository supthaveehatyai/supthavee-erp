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
import { vendorTransferNotice } from "@/lib/line/line-target";
import { LinePaymentSlipDialog } from "@/components/finance/line-payment-slip-dialog";
import { PaidSettlementBar } from "@/components/finance/paid-settlement-bar";
import { ReplacePaymentSlipDialog } from "@/components/finance/replace-payment-slip-dialog";
import { ContactBankAccountsPanel } from "@/components/finance/contact-bank-accounts-panel";
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
    <div className="flex flex-col gap-2 print:hidden">
    {doc.contact?.id ? (
      <ContactBankAccountsPanel
        contactId={doc.contact.id}
        contactName={doc.contact.company_name || "คู่ค้า"}
        layout="billing"
      />
    ) : null}
    <div className="flex flex-wrap items-start justify-between gap-3">
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
    </div>
      {alreadyPaid ? (
        <PaidSettlementCard
          contactId={doc.contact?.id ?? ""}
          contactName={doc.contact?.company_name ?? "คู่ค้า"}
          billingNoteNo={doc.doc_no}
          settlements={settlements}
        />
      ) : null}
    </div>
  );
}

function transferMessage(contactName: string, payment: BillingNoteSettlement): string {
  const amount = payment.amount.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return vendorTransferNotice(contactName, formatThaiDate(payment.paid_at ?? "", "short"), amount);
}

function PaidSettlementCard({
  billingNoteNo,
  contactId,
  contactName,
  settlements,
}: {
  billingNoteNo: string;
  contactId: string;
  contactName: string;
  settlements: BillingNoteSettlement[];
}) {
  const [linePayment, setLinePayment] = useState<BillingNoteSettlement | null>(null);
  const [replacePayment, setReplacePayment] = useState<BillingNoteSettlement | null>(null);
  const [sentAtByNo, setSentAtByNo] = useState<Record<string, string>>({});

  async function copyMessage(payment: BillingNoteSettlement) {
    try {
      await navigator.clipboard.writeText(transferMessage(contactName, payment));
      toast.success("คัดลอกข้อความแจ้งโอนแล้ว");
    } catch {
      toast.error("คัดลอกข้อความไม่สำเร็จ");
    }
  }

  return (
    <>
      {settlements.length === 0 ? (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/90 px-3 py-1.5 text-xs text-emerald-950">
          ✅ จ่ายแล้ว · ยังไม่พบใบสำคัญจ่ายที่ผูกกับบิลในใบวางบิลนี้
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {settlements.map((payment) => {
            const notifiedAt = payment.line_notified_at || sentAtByNo[payment.doc_no] || null;
            return (
            <PaidSettlementBar
              key={payment.doc_no}
              docNo={payment.doc_no}
              dateLabel={formatThaiDate(payment.paid_at ?? "", "short")}
              channelLabel={payment.channel_label}
              lineSent={payment.line_sent || Boolean(notifiedAt)}
              lineNotifiedAt={notifiedAt}
              slipUrl={payment.slip_urls[0]}
              onSendLine={() => setLinePayment(payment)}
              onCopy={() => void copyMessage(payment)}
              onReplaceSlip={() => setReplacePayment(payment)}
            />
            );
          })}
        </div>
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
        lastNotifiedAt={
          linePayment
            ? linePayment.line_notified_at || sentAtByNo[linePayment.doc_no] || null
            : null
        }
        messageText={linePayment ? transferMessage(contactName, linePayment) : ""}
        slipUrl={linePayment?.slip_urls.find((url) => url.startsWith("https://")) ?? null}
        onSent={() => {
          if (linePayment?.doc_no) {
            setSentAtByNo((current) => ({ ...current, [linePayment.doc_no]: new Date().toISOString() }));
          }
        }}
      />
      <ReplacePaymentSlipDialog
        open={replacePayment != null}
        onOpenChange={(next) => {
          if (!next) setReplacePayment(null);
        }}
        voucherDocId={replacePayment?.voucher_doc_id ?? ""}
        partyName={contactName}
        netAmount={replacePayment?.amount ?? 0}
      />
    </>
  );
}
