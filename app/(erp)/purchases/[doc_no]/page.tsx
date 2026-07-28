import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileInput } from "lucide-react";
import { getDocumentByNo } from "@/lib/actions/document-actions";
import { PURCHASE_DOC_TYPES } from "@/lib/constants/document";
import type { DocumentDetail, DocumentStatus, DocumentType } from "@/types/document";
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

type PageProps = {
  params: Promise<{ doc_no: string }>;
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
  return (
    <Badge variant="slate" className="font-semibold">
      {status}
    </Badge>
  );
}

function isPurchaseDocType(docType: DocumentType): boolean {
  return (PURCHASE_DOC_TYPES as readonly string[]).includes(docType);
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { doc_no } = await params;
  const decoded = decodeURIComponent(doc_no);
  return {
    title: `เอกสารซื้อ ${decoded} | Purchases`,
    description: `รายละเอียดเอกสารซื้อ ${decoded}`,
  };
}

/**
 * Server Component — purchase document read-only view.
 * Data via `getDocumentByNo` (Service Role). No client Supabase.
 */
export default async function PurchaseDocumentDetailPage({
  params,
}: PageProps) {
  const { doc_no: rawDocNo } = await params;
  const docNo = decodeURIComponent(rawDocNo);

  const result = await getDocumentByNo(docNo);
  if (result.error || !result.data) {
    notFound();
  }

  const doc: DocumentDetail = result.data;
  if (!isPurchaseDocType(doc.doc_type)) {
    notFound();
  }

  const grandTotal = Number(doc.grand_total ?? 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <FileInput className="size-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-mono text-xl font-bold tracking-tight text-slate-900">
                {doc.doc_no}
              </h1>
              {statusBadge(doc.status)}
            </div>
            <p className="mt-0.5 text-sm text-slate-500">
              {doc.doc_type} · วันที่เอกสาร {formatDate(doc.doc_date)}
            </p>
          </div>
        </div>

        <Link
          href="/purchases"
          className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
        >
          <ArrowLeft className="size-4" />
          กลับรายการเอกสารซื้อ
        </Link>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">ซัพพลายเออร์</CardTitle>
            <CardDescription>ข้อมูลจาก contacts</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="text-base font-semibold text-slate-900">
              {doc.contact?.company_name ?? "—"}
            </p>
            {doc.contact_person?.name ? (
              <p className="text-slate-600">
                ผู้ติดต่อ: {doc.contact_person.name}
              </p>
            ) : null}
            {doc.contact?.phone ? (
              <p className="text-slate-500">โทร: {doc.contact.phone}</p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">สรุปยอด</CardTitle>
            <CardDescription>สถานะ {doc.payment_status}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between gap-3">
              <span className="text-base font-bold text-slate-900">ยอดสุทธิ</span>
              <span className="text-lg font-bold tabular-nums text-blue-700">
                {formatMoney(grandTotal)}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">รายการสินค้า</CardTitle>
          <CardDescription>{doc.items.length} รายการ</CardDescription>
        </CardHeader>
        <CardContent className="px-0 sm:px-6">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>รายการ</TableHead>
                  <TableHead className="text-right">จำนวน</TableHead>
                  <TableHead className="text-right">ราคา/หน่วย</TableHead>
                  <TableHead className="text-right">รวม</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doc.items.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="h-20 text-center text-slate-500"
                    >
                      ไม่มีรายการสินค้า
                    </TableCell>
                  </TableRow>
                ) : (
                  doc.items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell>
                        <div className="font-medium text-slate-900">
                          {item.description || item.product_name || "—"}
                        </div>
                        {item.sku ? (
                          <div className="font-mono text-xs text-slate-400">
                            {item.sku}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.qty} {item.uom_used ?? ""}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(item.unit_price)}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(item.line_total)}
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
