import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { FileText, Plus } from "lucide-react";
import { getSalesDocuments } from "@/lib/actions/document-actions";
import type { DocumentStatus, DocumentType } from "@/types/document";
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

export const metadata: Metadata = {
  title: "เอกสารขาย | Sales Documents",
  description: "ประวัติเอกสารขายทั้งหมด",
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

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function docTypeLabel(docType: DocumentType): string {
  const labels: Partial<Record<DocumentType, string>> = {
    QT: "ใบเสนอราคา",
    SO: "ใบสั่งขาย",
    ABB: "ใบเสร็จอย่างย่อ",
    DEP_IN: "ใบมัดจำรับ",
    DEP: "ใบมัดจำ",
    INV_DO: "ใบส่งของ",
    TAX_INV: "ใบกำกับภาษี",
    CS_TAX: "ใบกำกับเงินสด",
    REC: "ใบเสร็จรับเงิน",
    CN: "ใบลดหนี้",
    AR_REFUND: "ใบสำคัญจ่ายเงินคืน (Refund Payment)",
    AR_WRITEOFF: "ใบสำคัญปรับปรุงบัญชี - รับรู้รายได้ (Write-off Income)",
  };
  return labels[docType] ?? docType;
}

function statusBadge(status: DocumentStatus) {
  if (status === "COMPLETED" || status === "ISSUED") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
        {status === "COMPLETED" ? "COMPLETED" : status}
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
  if (status === "CANCELLED" || status === "VOID") {
    return (
      <Badge className="border-red-200 bg-red-50 text-red-700 hover:bg-red-50">
        {status}
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

export default async function SalesDocumentsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const filters = {
    search: params.search,
    from: params.from,
    to: params.to,
  };
  const hasActiveFilters = Boolean(
    filters.search?.trim() || filters.from?.trim() || filters.to?.trim(),
  );

  const { data: documents, error } = await getSalesDocuments(filters);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="size-6 text-blue-700" />
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              เอกสารขาย
            </h1>
          </div>
          <p className="text-sm text-slate-500">
            ประวัติเอกสารขายทั้งหมด (เรียงจากใหม่ไปเก่า)
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Link
            href="/sales/orders/create"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-violet-50 px-4 text-sm font-semibold text-violet-800 shadow-sm transition hover:bg-violet-100"
          >
            <Plus className="size-4" />
            เปิดใบสั่งขาย (SO)
          </Link>
          <Link
            href="/sales/create"
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="size-4" />
            เปิดบิลขาย (+)
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader className="space-y-4 pb-3">
          <div>
            <CardTitle className="text-base">รายการเอกสาร</CardTitle>
            <CardDescription>
              {hasActiveFilters
                ? `ผลการค้นหา ${documents.length} รายการ`
                : `แสดงล่าสุด ${documents.length} รายการ`}
              {error ? ` — เกิดข้อผิดพลาด: ${error}` : null}
            </CardDescription>
          </div>
          <Suspense fallback={<FilterFallback />}>
            <DocumentFilter searchPlaceholder="ชื่อลูกค้า / เลขที่เอกสาร" />
          </Suspense>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">วันที่</TableHead>
                  <TableHead className="whitespace-nowrap">เลขที่เอกสาร</TableHead>
                  <TableHead className="whitespace-nowrap">ประเภท</TableHead>
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
                      colSpan={7}
                      className="h-24 text-center text-slate-500"
                    >
                      {error
                        ? "ไม่สามารถโหลดข้อมูลได้"
                        : hasActiveFilters
                          ? "ไม่พบเอกสารที่ตรงกับเงื่อนไขการค้นหา"
                          : "ยังไม่มีเอกสารขาย — กด «เปิดบิลขาย (+)» เพื่อสร้างรายการแรก"}
                    </TableCell>
                  </TableRow>
                ) : (
                  documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="whitespace-nowrap text-slate-700">
                        {formatDate(doc.doc_date || doc.created_at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-900">
                        {doc.doc_no}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className="text-sm text-slate-700">
                          {docTypeLabel(doc.doc_type)}
                        </span>
                        <span className="ml-1.5 font-mono text-xs text-slate-400">
                          ({doc.doc_type})
                        </span>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-slate-700">
                        {doc.customer_name ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-slate-900">
                        {formatMoney(doc.grand_total)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {statusBadge(doc.status)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <Link
                          href={`/sales/${encodeURIComponent(doc.doc_no)}`}
                          className="inline-flex h-8 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          ดูรายละเอียด
                        </Link>
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
