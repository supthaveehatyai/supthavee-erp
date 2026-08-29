import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Wht50TawiPrintLayout } from "@/components/tax/wht-50tawi-print-layout";
import { loadWht50TawiPrintData } from "@/lib/tax/wht-50tawi-data";
import type { WHTReportSource } from "@/types/tax";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    source?: string;
    id?: string;
    year?: string;
    month?: string;
  }>;
};

function parseSource(raw?: string): WHTReportSource | null {
  const value = raw?.trim().toUpperCase();
  if (value === "EXP" || value === "TB") return value;
  return null;
}

function buildCloseHref(yearRaw?: string, monthRaw?: string): string {
  const params = new URLSearchParams();
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (Number.isInteger(year) && year >= 2000) params.set("year", String(year));
  if (Number.isInteger(month) && month >= 1 && month <= 12) {
    params.set("month", String(month));
  }
  const qs = params.toString();
  return qs ? `/tax/wht-report?${qs}` : "/tax/wht-report";
}

export async function generateMetadata({
  searchParams,
}: PageProps): Promise<Metadata> {
  const params = await searchParams;
  const source = parseSource(params.source);
  const id = params.id?.trim() ?? "";
  if (!source || !id) {
    return { title: { absolute: "WHT_50Tawi" } };
  }

  const result = await loadWht50TawiPrintData(source, id);
  const docNo = result.success ? result.data.documentNo : id.slice(0, 8);
  return { title: { absolute: `WHT_${docNo}` } };
}

export default async function WhtReportPrint50TawiPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const source = parseSource(params.source);
  const documentId = params.id?.trim() ?? "";

  if (!source || !documentId) {
    notFound();
  }

  const result = await loadWht50TawiPrintData(source, documentId);
  const closeHref = buildCloseHref(params.year, params.month);

  if (!result.success) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 font-sarabun print:hidden">
        <p className="text-sm text-slate-600">{result.error}</p>
        <Link
          href={closeHref}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          กลับรายงาน WHT
        </Link>
      </div>
    );
  }

  return (
    <Wht50TawiPrintLayout
      payload={result.data}
      payer={result.payer}
      closeHref={closeHref}
    />
  );
}
