import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getCreditNoteSourceAction } from "@/lib/actions/credit-note-actions";
import CreditNoteCreateWorkspace from "./credit-note-create-workspace";

export const metadata: Metadata = {
  title: "สร้างใบลดหนี้ | Credit Note",
  description:
    "Phase 18 — ใบลดหนี้ AR ต้องอ้างบิลขายต้นทาง (ห้ามเปิด CN ลอย)",
};

type PageProps = {
  searchParams: Promise<{ ref_doc_id?: string }>;
};

/**
 * Server Component — โหลดบิลต้นทางผ่าน Server Action เท่านั้น
 * บังคับมี `?ref_doc_id=UUID`
 */
export default async function CreateCreditNotePage({ searchParams }: PageProps) {
  const params = await searchParams;
  const refDocId = String(params.ref_doc_id ?? "").trim();

  if (!refDocId) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950">
          <p className="font-semibold">ไม่สามารถเปิดใบลดหนี้ลอยได้</p>
          <p className="mt-1 text-amber-900/80">
            ต้องเข้าผ่านบิลขายต้นทาง
            {" "}
            <span className="font-mono">/sales/cn/create?ref_doc_id=UUID</span>
          </p>
          <Link
            href="/sales"
            className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-700 underline-offset-2 hover:underline"
          >
            <ArrowLeft className="size-4" />
            กลับรายการเอกสารขาย
          </Link>
        </div>
      </div>
    );
  }

  const result = await getCreditNoteSourceAction(refDocId);
  if (!result.data) {
    return (
      <div className="mx-auto max-w-xl p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800">
          <p className="font-semibold">โหลดบิลขายต้นทางไม่สำเร็จ</p>
          <p className="mt-1">{result.error ?? "ไม่พบเอกสารอ้างอิง"}</p>
          <Link
            href="/sales"
            className="mt-3 inline-flex items-center gap-1.5 font-medium text-red-900 underline-offset-2 hover:underline"
          >
            <ArrowLeft className="size-4" />
            กลับรายการเอกสารขาย
          </Link>
        </div>
      </div>
    );
  }

  return <CreditNoteCreateWorkspace source={result.data} />;
}
