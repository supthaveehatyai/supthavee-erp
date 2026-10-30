import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileInput, PackagePlus, ScanLine } from "lucide-react";
import { getPurchaseDocuments } from "@/lib/actions/document-actions";
import DocumentFilter from "@/components/documents/document-filter";
import { PurchaseTaxMatchTable } from "@/components/procurement/purchase-tax-match-table";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const metadata: Metadata = {
  title: "เอกสารซื้อ | Purchase Documents",
  description: "ประวัติเอกสารซื้อ (PO) และลิงก์ไปรับสินค้าอัจฉริยะ",
};

type PageProps = {
  searchParams: Promise<{
    search?: string;
    from?: string;
    to?: string;
  }>;
};

const GOODS_RECEIPT_HREF = "/dashboard/procurement/goods-receipt";

function FilterFallback() {
  return (
    <div className="h-[88px] animate-pulse rounded-xl border border-slate-200 bg-slate-50/60" />
  );
}

export default async function PurchaseDocumentsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const filters = {
    search: params.search,
    from: params.from,
    to: params.to,
  };
  const hasActiveFilters = Boolean(
    filters.search?.trim() || filters.from?.trim() || filters.to?.trim(),
  );

  const { data: documents, error } = await getPurchaseDocuments(filters, 200);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileInput className="size-6 text-blue-700" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              เอกสารซื้อ
            </h1>
          </div>
          <p className="text-sm text-slate-500">
            ประวัติใบสั่งซื้อ (PO) และใบรับสินค้า (REC) — เรียงจากใหม่ไปเก่า
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/finance/reports"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-4 text-sm font-semibold text-amber-900 shadow-sm transition hover:bg-amber-100"
          >
            ชุดใบรับเงิน 1.2
          </Link>
          <Link
            href="/purchases/manual-receipt"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
          >
            <PackagePlus className="size-4" />
            รับสินค้า (Manual)
          </Link>
          <Link
            href={GOODS_RECEIPT_HREF}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <ScanLine className="size-4" />
            รับสินค้าอัจฉริยะ (OCR)
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-4 pb-3">
          <div>
            <CardTitle className="text-base">รายการเอกสารซื้อ</CardTitle>
            <CardDescription>
              {hasActiveFilters
                ? `ผลการค้นหา ${documents.length} รายการ`
                : `แสดงล่าสุด ${documents.length} รายการ`}
              {error ? ` — เกิดข้อผิดพลาด: ${error}` : null}
            </CardDescription>
          </div>
          <Suspense fallback={<FilterFallback />}>
            <DocumentFilter searchPlaceholder="ชื่อซัพพลายเออร์ / เลขที่เอกสาร" />
          </Suspense>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <PurchaseTaxMatchTable
            documents={documents}
            hasActiveFilters={hasActiveFilters}
            error={error}
          />
        </CardContent>
      </Card>
    </div>
  );
}
