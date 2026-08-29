import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Wht50TawiPrintLayout } from "@/components/tax/wht-50tawi-print-layout";
import { loadWht50TawiPrintData } from "@/lib/tax/wht-50tawi-data";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const expenseId = id?.trim() ?? "";
  if (!expenseId) {
    return { title: { absolute: "WHT" } };
  }

  const result = await loadWht50TawiPrintData("EXP", expenseId);
  const expenseNo = result.success
    ? result.data.documentNo
    : expenseId.slice(0, 8);
  return { title: { absolute: `WHT_${expenseNo}` } };
}

export default async function PrintWhtCertificatePage({ params }: PageProps) {
  const { id } = await params;
  const expenseId = id?.trim() ?? "";
  if (!expenseId) notFound();

  const result = await loadWht50TawiPrintData("EXP", expenseId);

  if (!result.success) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 font-sarabun print:hidden">
        <p className="text-sm text-slate-600">{result.error}</p>
        <a
          href={`/expenses/${expenseId}`}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          กลับหน้ารายละเอียด
        </a>
      </div>
    );
  }

  return (
    <Wht50TawiPrintLayout
      payload={result.data}
      payer={result.payer}
      closeHref={`/expenses/${expenseId}`}
    />
  );
}
