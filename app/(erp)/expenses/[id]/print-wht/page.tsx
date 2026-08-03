import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer } from "lucide-react";
import { createClient } from "@/lib/supabase/server-admin";
import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import { AutoPrint } from "./auto-print";
import { Wht50TawiCertificate } from "./wht-50tawi-certificate";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{ id: string }>;
};

/** ผู้มีหน้าที่หักภาษี — ล็อกตายตัวตามตราประทับบริษัท */
const PAYER = {
  name: "บริษัท ทรัพย์ทวี หาดใหญ่ จำกัด",
  taxId: "0905564000520",
  address:
    "234-235 ถนนเพชรเกษม ตำบลหาดใหญ่ อำเภอหาดใหญ่ จังหวัดสงขลา",
} as const;

/** ชื่อฉบับมุมบน ตามต้นฉบับกรมสรรพากร */
const COPY_TITLES = [
  "ฉบับที่ 1 ( สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี )",
  "ฉบับที่ 2 ( สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน )",
  "ฉบับที่ 3 ( สำหรับผู้หักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี )",
  "ฉบับที่ 4 ( สำหรับผู้หักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน )",
] as const;

type VendorJoin = {
  company_name?: string | null;
  tax_id?: string | null;
  tax_branch_code?: string | null;
  tax_address?: string | null;
  address?: string | null;
  entity_type?: string | null;
};

function unwrapJoin<T extends object>(
  value: T | T[] | null | undefined,
): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function toMoney(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** XX-XXX-XXXX-XX-XX ตามแบบฟอร์ม */
function formatTaxIdDisplay(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return digits || "- ---- ----- -- -";
  return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5, 9)}-${digits.slice(9, 11)}-${digits.slice(11, 13)}`;
}

/** วันจ่ายแบบสั้น พ.ศ. เช่น 24/06/69 */
function formatPayDateShort(value: string): string {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String((date.getFullYear() + 543) % 100).padStart(2, "0");
  return `${dd}/${mm}/${yy}`;
}

/**
 * ตั้งชื่อแท็บ/ไฟล์ PDF = WHT_{document_no}
 * (ตาราง expenses ใช้ document_no เป็นเลขที่เอกสาร — ไม่มีคอลัมน์ expense_no)
 */
export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const expenseId = id?.trim() ?? "";
  if (!expenseId) {
    return { title: { absolute: "WHT" } };
  }

  const supabase = createClient();
  const { data } = await supabase
    .from("expenses")
    .select("document_no")
    .eq("id", expenseId)
    .maybeSingle();

  const expenseNo = data?.document_no?.trim() || expenseId.slice(0, 8);
  return {
    title: { absolute: `WHT_${expenseNo}` },
  };
}

export default async function PrintWhtCertificatePage({ params }: PageProps) {
  const { id } = await params;
  const expenseId = id?.trim() ?? "";
  if (!expenseId) notFound();

  const supabase = createClient();
  const { data, error } = await supabase
    .from("expenses")
    .select(
      `
      id,
      document_no,
      expense_date,
      wht_base_amount,
      wht_amount,
      wht_doc_no,
      net_amount,
      contacts!expenses_vendor_id_fkey (
        company_name,
        tax_id,
        tax_branch_code,
        tax_address,
        address,
        entity_type
      )
    `,
    )
    .eq("id", expenseId)
    .maybeSingle();

  if (error || !data) {
    notFound();
  }

  const whtAmount = toMoney(data.wht_amount);
  if (whtAmount <= 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 font-sarabun print:hidden">
        <p className="text-sm text-slate-600">
          เอกสารนี้ไม่มียอดหัก ณ ที่จ่าย (wht_amount = 0)
        </p>
        <Link
          href={`/expenses/${expenseId}`}
          className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          กลับหน้ารายละเอียด
        </Link>
      </div>
    );
  }

  const vendor = unwrapJoin(data.contacts as VendorJoin | VendorJoin[] | null);
  const whtBase =
    data.wht_base_amount != null && Number(data.wht_base_amount) > 0
      ? toMoney(data.wht_base_amount)
      : toMoney(data.net_amount);

  const expenseDate = String(data.expense_date ?? "").slice(0, 10);
  const certNo =
    data.wht_doc_no?.trim() || data.document_no || expenseId.slice(0, 8);

  const whtAmountText = numberToThaiBaht(whtAmount);

  const certificateProps = {
    certNo,
    payDateShort: formatPayDateShort(expenseDate),
    payer: {
      name: PAYER.name,
      taxIdFormatted: formatTaxIdDisplay(PAYER.taxId),
      address: PAYER.address,
    },
    payee: {
      name: vendor?.company_name?.trim() || "—",
      taxIdFormatted: formatTaxIdDisplay(vendor?.tax_id),
      address: vendor?.tax_address?.trim() || vendor?.address?.trim() || "—",
      entityType: vendor?.entity_type ?? null,
    },
    whtBase,
    whtAmount,
    whtAmountText,
  };

  return (
    <div className="font-sarabun">
      <AutoPrint />

      <div className="print:hidden sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div>
          <p className="text-sm font-semibold text-slate-800">
            หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ) — 4 ฉบับ
          </p>
          <p className="text-xs text-slate-500">
            {data.document_no} · {certificateProps.payDateShort}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            id="wht-manual-print-btn"
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white"
          >
            <Printer className="h-3.5 w-3.5" />
            พิมพ์อีกครั้ง
          </button>
          <Link
            href={`/expenses/${expenseId}`}
            className="inline-flex h-9 items-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
          >
            ปิด
          </Link>
        </div>
      </div>

      <script
        dangerouslySetInnerHTML={{
          __html: `
            (function () {
              var btn = document.getElementById('wht-manual-print-btn');
              if (btn) btn.addEventListener('click', function () { window.print(); });
            })();
          `,
        }}
      />

      <div className="bg-slate-200 py-4 print:bg-white print:py-0">
        {COPY_TITLES.map((copyTitle, index) => (
          <div
            key={copyTitle}
            className={
              index < COPY_TITLES.length - 1
                ? "mb-4 print:mb-0 print:break-after-page page-break-after-always"
                : ""
            }
          >
            <Wht50TawiCertificate copyTitle={copyTitle} {...certificateProps} />
          </div>
        ))}
      </div>
    </div>
  );
}
