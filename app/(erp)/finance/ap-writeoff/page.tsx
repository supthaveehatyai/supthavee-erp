import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { FileMinus2, Plus } from "lucide-react";
import { listApWriteoffs } from "@/app/actions/ap-writeoff";
import { ApWriteoffPreviewContent } from "@/components/finance/ApWriteoffPreviewContent";
import { ApWriteoffQueryFilter } from "@/components/finance/ApWriteoffQueryFilter";
import { ApWriteoffRowActions } from "@/components/finance/ApWriteoffRowActions";
import { DocumentPreviewSheet } from "@/components/finance/DocumentPreviewSheet";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import type { ApWriteoffListStatus } from "@/types/ap-writeoff";
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
  title: "ประวัติตัดหนี้สูญเจ้าหนี้ | AP Write-off",
  description: "รายการใบสำคัญตัดหนี้สูญ / ตัดเศษบัญชีเจ้าหนี้การค้า",
};

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type ApWriteoffIndexProps = {
  searchParams: Promise<{ query?: string; preview_doc_id?: string }>;
};

function formatThaiBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}

function buildPreviewHref(query: string, documentId: string): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("query", query.trim());
  params.set("preview_doc_id", documentId);
  return `/finance/ap-writeoff?${params.toString()}`;
}

function StatusBadge({ status }: { status: ApWriteoffListStatus }) {
  if (status === "ISSUED") {
    return <Badge variant="emerald">ISSUED</Badge>;
  }
  if (status === "PENDING") {
    return <Badge variant="amber">รออนุมัติ (PENDING)</Badge>;
  }
  if (status === "VOID") {
    return (
      <Badge variant="amber" className="bg-red-100 text-red-700">
        VOID
      </Badge>
    );
  }
  return <Badge variant="slate">DRAFT</Badge>;
}

export default async function ApWriteoffIndexPage({
  searchParams,
}: ApWriteoffIndexProps) {
  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const previewDocId = params.preview_doc_id?.trim() || null;
  const result = await listApWriteoffs(query);

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <FileMinus2 className="h-8 w-8 text-blue-600" />
            ตัดหนี้สูญเจ้าหนี้ (AP Write-off)
          </h1>
          <p className="text-slate-500">
            ประวัติใบสำคัญตัดหนี้สูญ / ตัดเศษบัญชี — กรองด้วย{" "}
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
              ?query=
            </code>{" "}
            (Zero Client-Side Fetching)
          </p>
        </div>

        <Link
          href="/finance/ap-writeoff/create"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          เปิดบิลตัดหนี้สูญ
        </Link>
      </div>

      <ApWriteoffQueryFilter query={query} />

      {result.error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ไม่สามารถโหลดประวัติตัดหนี้สูญได้: {result.error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">ประวัติ AP_WRITEOFF</CardTitle>
          <CardDescription>
            เรียงตามวันที่บันทึก (created_at / Posting Date) จากใหม่ไปเก่า —
            ตาราง documents ไม่มีคอลัมน์ posting_date
          </CardDescription>
        </CardHeader>
        <CardContent>
          {result.data.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-500">
              {query
                ? `ไม่พบเอกสารที่ตรงกับ “${query}”`
                : "ยังไม่มีใบสำคัญตัดหนี้สูญ — กด “เปิดบิลตัดหนี้สูญ” เพื่อเริ่มบันทึก"}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="whitespace-nowrap">วันที่</TableHead>
                    <TableHead className="whitespace-nowrap">
                      เลขที่เอกสาร
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      ผู้ทำรายการ
                    </TableHead>
                    <TableHead className="whitespace-nowrap text-right">
                      ยอดตัดบัญชีรวม
                    </TableHead>
                    <TableHead>หมายเหตุ</TableHead>
                    <TableHead className="whitespace-nowrap">สถานะ</TableHead>
                    <TableHead className="whitespace-nowrap text-right">
                      Action
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {result.data.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm font-medium tabular-nums text-slate-900">
                        {formatThaiDate(row.created_at, "short")}
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                          {row.doc_no || "—"}
                        </code>
                      </TableCell>
                      <TableCell className="text-sm text-slate-800">
                        {row.created_by_name}
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums text-slate-900">
                        {formatThaiBaht(row.grand_total)}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate text-sm text-slate-500">
                        {row.remark?.trim() || "—"}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={row.list_status} />
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end">
                          <ApWriteoffRowActions
                            documentId={row.id}
                            docNo={row.doc_no}
                            listStatus={row.list_status}
                            previewHref={buildPreviewHref(query, row.id)}
                          />
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DocumentPreviewSheet previewDocId={previewDocId}>
        {previewDocId ? (
          <Suspense
            fallback={
              <div className="px-6 py-8 text-sm text-slate-500">
                กำลังโหลดรายละเอียดเอกสาร...
              </div>
            }
          >
            <ApWriteoffPreviewContent documentId={previewDocId} />
          </Suspense>
        ) : null}
      </DocumentPreviewSheet>
    </div>
  );
}
