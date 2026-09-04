import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { getSalesOrders } from "@/lib/actions/sales-order-actions";
import type { DocumentStatus } from "@/types/document";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import DocumentFilter from "@/components/documents/document-filter";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ใบสั่งขาย | Sales Orders",
  description: "รายการใบสั่งขาย (SO) — จองสต็อกและส่งงานผลิต MTO",
};

type PageProps = {
  searchParams: Promise<{
    search?: string;
    from?: string;
    to?: string;
  }>;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function statusBadge(status: DocumentStatus) {
  if (status === "ISSUED" || status === "COMPLETED") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
        {status}
      </Badge>
    );
  }
  if (status === "DRAFT") {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
        DRAFT
      </Badge>
    );
  }
  return (
    <Badge variant="slate" className="font-semibold">
      {status}
    </Badge>
  );
}

function FilterFallback() {
  return (
    <div className="h-[88px] animate-pulse rounded-xl border border-slate-200 bg-slate-50/60" />
  );
}

export default async function SalesOrdersPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = {
    search: params.search,
    from: params.from,
    to: params.to,
  };
  const hasActiveFilters = Boolean(
    filters.search?.trim() || filters.from?.trim() || filters.to?.trim(),
  );
  const { data: documents, error } = await getSalesOrders(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <ClipboardList className="size-6 text-violet-700" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              ใบสั่งขาย (Sales Order)
            </h1>
          </div>
          <p className="text-sm text-slate-500">
            จองสต็อก (ATP) และส่งงานผลิต MTO จากเอกสาร SO
          </p>
        </div>
        <Link
          href="/sales/orders/create"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-violet-700"
        >
          <Plus className="size-4" />
          สร้างใบสั่งขาย
        </Link>
      </div>

      <Card>
        <CardHeader className="space-y-4 pb-3">
          <div>
            <CardTitle className="text-base">รายการใบสั่งขาย</CardTitle>
            <CardDescription>
              {hasActiveFilters
                ? `ผลการค้นหา ${documents.length} รายการ`
                : `แสดงล่าสุด ${documents.length} รายการ`}
              {error ? ` — เกิดข้อผิดพลาด: ${error}` : null}
            </CardDescription>
          </div>
          <Suspense fallback={<FilterFallback />}>
            <DocumentFilter searchPlaceholder="ชื่อลูกค้า / เลขที่ SO" />
          </Suspense>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">วันที่</TableHead>
                  <TableHead className="whitespace-nowrap">เลขที่เอกสาร</TableHead>
                  <TableHead>ลูกค้า</TableHead>
                  <TableHead className="whitespace-nowrap text-right">
                    ยอดสุทธิ
                  </TableHead>
                  <TableHead className="whitespace-nowrap">สถานะ</TableHead>
                  <TableHead className="whitespace-nowrap text-right">
                    การดำเนินการ
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="h-24 text-center text-slate-500"
                    >
                      {error
                        ? "ไม่สามารถโหลดข้อมูลได้"
                        : hasActiveFilters
                          ? "ไม่พบใบสั่งขายที่ตรงกับเงื่อนไข"
                          : "ยังไม่มีใบสั่งขาย — กด «สร้างใบสั่งขาย» เพื่อเริ่มงาน MTO"}
                    </TableCell>
                  </TableRow>
                ) : (
                  documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="whitespace-nowrap text-slate-700">
                        {formatThaiDate(doc.doc_date || doc.created_at, "short")}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-900">
                        {doc.doc_no}
                      </TableCell>
                      <TableCell className="text-slate-700">
                        {doc.customer_name || "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-slate-800">
                        {formatMoney(doc.grand_total)}
                      </TableCell>
                      <TableCell>{statusBadge(doc.status)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <div className="flex justify-end gap-2">
                          {doc.status === "DRAFT" ? (
                            <Link
                              href={`/sales/orders/edit/${encodeURIComponent(doc.id)}`}
                              className="text-sm font-semibold text-violet-700 hover:underline"
                            >
                              แก้ไข
                            </Link>
                          ) : null}
                          <Link
                            href={`/sales/${encodeURIComponent(doc.doc_no)}`}
                            className="text-sm font-semibold text-blue-700 hover:underline"
                          >
                            ดูเอกสาร
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
