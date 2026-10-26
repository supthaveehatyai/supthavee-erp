"use client";

/**
 * Billing Note detail — screen chrome only.
 * Print document rendered by BillingNotePrintTemplate (Server Component).
 */

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import type { BillingNoteDetailData, BillingNoteSettlement } from "@/types/billing";
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
  const titleTh = isBN ? "ใบวางบิล" : "ใบรับวางบิล";
  const titleEn = isBN ? "Billing Note" : "Bill Receipt";
  const listHref = `/finance/billing-notes?type=${doc.doc_type}`;
  const paymentStatus = doc.payment_status.trim().toUpperCase();
  const awaitingPayment =
    !isBN && (paymentStatus === "PENDING" || paymentStatus === "UNPAID" || paymentStatus === "PARTIAL");
  const alreadyPaid = !isBN && (paymentStatus === "PAID" || paymentStatus === "COMPLETED");

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
          <div className="max-w-md rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            <div className="font-semibold">✅ จ่ายชำระแล้ว (PAID)</div>
            {settlements.length === 0 ? (
              <p className="mt-1 text-xs">ยังไม่พบใบสำคัญจ่ายที่ผูกกับบิลในใบวางบิลนี้</p>
            ) : (
              <ul className="mt-1 space-y-1">
                {settlements.map((payment) => (
                  <li key={payment.doc_no} className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{payment.doc_no}</span>
                    {payment.slip_urls.map((url) => (
                      <a
                        key={url}
                        href={url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-emerald-800 underline"
                      >
                        ดูสลิปโอนเงิน
                      </a>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
