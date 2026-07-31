"use client";

/**
 * Billing Note detail + A4 print layout.
 * Data from Server Component props only — no client Supabase.
 */

import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";
import type { BillingNoteDetailData } from "@/app/actions/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type BillingNoteDetailProps = {
  document: BillingNoteDetailData;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

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
  const partyLabel = isBN ? "ลูกค้า / Bill To" : "คู่ค้า / Bill From";
  const listHref = `/finance/billing-notes?type=${doc.doc_type}`;
  const lineTotal = doc.invoices.reduce(
    (sum, line) => sum + line.billed_amount,
    0,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* Screen chrome */}
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

      {/* A4 print document */}
      <article
        id="billing-note-print-document"
        className={cn(
          "mx-auto w-full max-w-[210mm] min-h-[297mm] rounded-2xl border border-slate-200 bg-white p-8 text-black shadow-sm",
          "print:m-0 print:w-full print:max-w-none print:min-h-0 print:rounded-none print:border-0 print:p-0 print:shadow-none",
        )}
      >
        <header className="border-b border-neutral-300 pb-5">
          <div className="flex items-start justify-between gap-6">
            <div className="flex items-start gap-3">
              <div className="grid size-12 place-items-center rounded-md border border-neutral-300 bg-neutral-50 text-sm font-black tracking-tight text-neutral-800">
                ST
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight text-neutral-950">
                  บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
                </h1>
                <p className="mt-0.5 text-xs text-neutral-600">
                  Supthavee Hatyai Co., Ltd.
                </p>
                <p className="mt-2 max-w-sm text-[11px] leading-relaxed text-neutral-500">
                  ระบบ ERP — เอกสารวางบิล / Billing Note
                </p>
              </div>
            </div>

            <div className="text-right">
              <p className="text-base font-bold text-neutral-950">
                {titleTh}
              </p>
              <p className="text-xs text-neutral-600">{titleEn}</p>
              <p className="mt-2 font-mono text-sm font-semibold text-neutral-900">
                เลขที่ {doc.doc_no}
              </p>
              <p className="mt-1 text-xs text-neutral-600">
                วันที่เอกสาร: {formatDate(doc.doc_date)}
              </p>
              {doc.due_date ? (
                <p className="mt-0.5 text-xs text-neutral-600">
                  วันครบกำหนด: {formatDate(doc.due_date)}
                </p>
              ) : null}
              <p className="mt-2 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
                สถานะ: {doc.payment_status}
              </p>
            </div>
          </div>

          <div className="mt-5 border-t border-neutral-200 pt-4">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-neutral-500">
              {partyLabel}
            </p>
            <p className="mt-1 text-sm font-semibold text-neutral-900">
              {doc.contact?.company_name ?? "—"}
            </p>
            {doc.contact?.tax_id ? (
              <p className="mt-0.5 text-xs text-neutral-600">
                เลขผู้เสียภาษี: {doc.contact.tax_id}
              </p>
            ) : null}
            {doc.contact?.branch_code ? (
              <p className="text-xs text-neutral-600">
                สาขา: {doc.contact.branch_code}
              </p>
            ) : null}
            {doc.contact?.address ? (
              <p className="mt-1 max-w-xl whitespace-pre-wrap text-xs leading-relaxed text-neutral-600">
                {doc.contact.address}
              </p>
            ) : null}
            {doc.contact?.phone ? (
              <p className="text-xs text-neutral-600">
                โทร: {doc.contact.phone}
              </p>
            ) : null}
          </div>
        </header>

        <section className="mt-6">
          <h2 className="mb-2 text-xs font-bold uppercase tracking-wide text-neutral-700">
            รายการเอกสารในใบวางบิล
          </h2>
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-neutral-400">
                <th className="py-2 pr-2 font-semibold text-neutral-700">#</th>
                <th className="py-2 pr-2 font-semibold text-neutral-700">
                  เลขที่เอกสาร
                </th>
                <th className="py-2 pr-2 font-semibold text-neutral-700">
                  วันที่
                </th>
                <th className="py-2 pr-2 font-semibold text-neutral-700">
                  ครบกำหนด
                </th>
                <th className="py-2 text-right font-semibold text-neutral-700">
                  ยอดวางบิล
                </th>
              </tr>
            </thead>
            <tbody>
              {doc.invoices.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-neutral-400"
                  >
                    ไม่พบรายการบิลในเอกสารนี้
                  </td>
                </tr>
              ) : (
                doc.invoices.map((line, index) => (
                  <tr
                    key={line.id}
                    className="border-b border-neutral-200 align-top"
                  >
                    <td className="py-2 pr-2 tabular-nums text-neutral-500">
                      {index + 1}
                    </td>
                    <td className="py-2 pr-2 font-mono text-[11px] font-medium text-neutral-800">
                      {line.invoice_doc_no}
                      <span className="ml-1 text-[10px] text-neutral-400">
                        ({line.invoice_doc_type})
                      </span>
                    </td>
                    <td className="py-2 pr-2 text-neutral-700">
                      {formatDateShort(line.invoice_doc_date)}
                    </td>
                    <td className="py-2 pr-2 text-neutral-700">
                      {formatDateShort(line.invoice_due_date)}
                    </td>
                    <td className="py-2 text-right tabular-nums text-neutral-900">
                      {formatMoney(line.billed_amount)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {doc.invoices.length > 0 ? (
              <tfoot>
                <tr className="border-t border-neutral-400">
                  <td
                    colSpan={4}
                    className="py-2 pr-2 text-right font-semibold text-neutral-800"
                  >
                    รวมทั้งสิ้น (Grand Total)
                  </td>
                  <td className="py-2 text-right font-bold tabular-nums text-neutral-950">
                    {formatMoney(doc.grand_total || lineTotal)}
                  </td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </section>

        <footer className="mt-10 grid grid-cols-3 gap-6 pt-4 text-center text-xs text-neutral-700">
          <div>
            <div className="mx-auto mb-10 h-16 w-36 border-b border-neutral-400" />
            <p className="font-semibold">ผู้จัดทำ / Prepared By</p>
            <p className="mt-1 text-[10px] text-neutral-500">ลายเซ็น / วันที่</p>
          </div>
          <div>
            <div className="mx-auto mb-10 h-16 w-36 border-b border-neutral-400" />
            <p className="font-semibold">ผู้รับเอกสาร / Received By</p>
            <p className="mt-1 text-[10px] text-neutral-500">ลายเซ็น / วันที่</p>
          </div>
          <div>
            <div className="mx-auto mb-10 h-16 w-36 border-b border-neutral-400" />
            <p className="font-semibold">ผู้อนุมัติ / Authorized By</p>
            <p className="mt-1 text-[10px] text-neutral-500">
              ในนามบริษัท ทรัพย์ทวี หาดใหญ่ จำกัด
            </p>
          </div>
        </footer>
      </article>
    </div>
  );
}
