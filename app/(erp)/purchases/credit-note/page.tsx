import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PurchaseCreditNoteForm } from "./purchase-credit-note-form";

export const metadata: Metadata = {
  title: "บันทึกใบลดหนี้ซื้อ | Purchase Credit Note",
};

type PageProps = {
  searchParams: Promise<{ vendor?: string; ref?: string }>;
};

export default async function PurchaseCreditNotePage({ searchParams }: PageProps) {
  const params = await searchParams;
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">บันทึกใบลดหนี้ซื้อ</h1>
          <p className="text-sm text-slate-500">
            ใบลดหนี้/ใบกำกับภาษีฝั่งซื้อ เลขที่ภายใน PCN-YYMM-XXXX
          </p>
        </div>
        <Link
          href="/purchases"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600"
        >
          <ArrowLeft className="size-4" />
          กลับรายการเอกสารซื้อ
        </Link>
      </div>
      <PurchaseCreditNoteForm
        initialVendorId={params.vendor?.trim() ?? ""}
        initialRefId={params.ref?.trim() ?? ""}
      />
    </div>
  );
}
