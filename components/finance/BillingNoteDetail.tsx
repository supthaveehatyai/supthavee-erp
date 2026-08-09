"use client";

/**
 * Billing Note detail — screen chrome only.
 * Print document rendered by BillingNotePrintTemplate (Server Component).
 */

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import type { BillingNoteDetailData } from "@/app/actions/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type BillingNoteDetailProps = {
  document: BillingNoteDetailData;
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

export function BillingNoteDetail({ document: doc }: BillingNoteDetailProps) {
  const isBN = doc.doc_type === "BN";
  const titleTh = isBN ? "ใบวางบิล" : "ใบรับวางบิล";
  const titleEn = isBN ? "Billing Note" : "Bill Receipt";
  const listHref = `/finance/billing-notes?type=${doc.doc_type}`;

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
  );
}
