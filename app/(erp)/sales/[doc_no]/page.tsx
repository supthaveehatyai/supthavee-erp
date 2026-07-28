import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { getDocumentByNo } from "@/lib/actions/document-actions";
import type { DocumentDetail, DocumentStatus } from "@/types/document";
import PrintDocumentTemplate from "@/components/sales/print-document-template";
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
import IssueDocumentButton from "./issue-document-button";
import PrintDocumentButton from "./print-document-button";
import ConvertDocumentDropdown from "./convert-document-dropdown";

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
        {status === "COMPLETED" ? "COMPLETED (ออกเอกสารแล้ว)" : status}
      </Badge>
    );
  }
  if (status === "DRAFT") {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
        DRAFT (ร่าง)
      </Badge>
    );
  }
  return (
    <Badge variant="slate" className="font-semibold">
      {status}
    </Badge>
  );
}

function SummaryRow({
  label,
  value,
  emphasize = false,
  negative = false,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={
          emphasize
            ? "text-base font-bold text-slate-900"
            : "text-sm text-slate-500"
        }
      >
        {label}
      </span>
      <span
        className={
          emphasize
            ? "text-lg font-bold tabular-nums text-blue-700"
            : negative
              ? "text-sm font-medium tabular-nums text-red-600"
              : "text-sm font-medium tabular-nums text-slate-800"
        }
      >
        {value}
      </span>
    </div>
  );
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { doc_no } = await params;
  const decoded = decodeURIComponent(doc_no);
  return {
    title: `เอกสาร ${decoded} | Sales`,
    description: `รายละเอียดเอกสารขาย ${decoded}`,
  };
}

/**
 * Server Component — document read-only view + A4 print layout.
 * Data via `getDocumentByNo` (Service Role). No client Supabase.
 */
export default async function SalesDocumentDetailPage({ params }: PageProps) {
  const { doc_no: rawDocNo } = await params;
  const docNo = decodeURIComponent(rawDocNo);

  const result = await getDocumentByNo(docNo);
  if (result.error || !result.data) {
    notFound();
  }

  const doc: DocumentDetail = result.data;
  const canIssue = doc.status === "DRAFT";
  const canPrint = doc.status === "DRAFT" || doc.status === "COMPLETED";
  const canConvert = doc.doc_type === "QT" && doc.status === "COMPLETED";
  const subtotal = Number(doc.total_amount ?? doc.sub_total ?? 0);
  const discountAmount = Number(doc.discount_amount ?? 0);
  const netBeforeVat = Number(doc.net_before_vat ?? subtotal - discountAmount);
  const vatAmount = Number(doc.vat_amount ?? doc.tax_amount ?? 0);
  const vatRate = Number(doc.vat_rate ?? doc.tax_rate ?? 7);
  const grandTotal = Number(doc.grand_total ?? 0);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 sm:p-6 print:max-w-none print:gap-0 print:p-0">
      {/* Screen-only chrome / actions */}
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-blue-50 text-blue-600">
            <FileText className="size-5" />
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

        <div className="flex flex-wrap items-center gap-2 print:hidden">
          <Link
            href="/sales/create"
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <ArrowLeft className="size-4" />
            เปิดบิลใหม่
          </Link>
          {canPrint && <PrintDocumentButton className="h-10 gap-2" />}
          {canConvert && (
            <ConvertDocumentDropdown
              sourceDocId={doc.id}
              sourceDocNo={doc.doc_no}
            />
          )}
          {canIssue && (
            <IssueDocumentButton documentId={doc.id} docNo={doc.doc_no} />
          )}
        </div>
      </div>

      {/* Screen-only interactive / card view */}
      <div className="flex flex-col gap-4 print:hidden">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">ลูกค้า</CardTitle>
              <CardDescription>
                ข้อมูลจาก contacts / contact_persons
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-base font-semibold text-slate-900">
                {doc.contact?.company_name ?? "—"}
              </p>
              {doc.contact?.tax_id && (
                <p className="text-slate-600">
                  เลขผู้เสียภาษี: {doc.contact.tax_id}
                </p>
              )}
              {doc.contact?.branch_code && (
                <p className="text-slate-600">
                  สาขา: {doc.contact.branch_code}
                </p>
              )}
              {doc.contact?.address && (
                <p className="whitespace-pre-wrap text-slate-600">
                  {doc.contact.address}
                </p>
              )}
              {doc.contact?.phone && (
                <p className="text-slate-600">โทร: {doc.contact.phone}</p>
              )}
              {doc.contact_person && (
                <div className="mt-3 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <p className="text-xs font-semibold text-slate-500">
                    ผู้ติดต่อ
                  </p>
                  <p className="font-medium text-slate-800">
                    {doc.contact_person.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {[
                      doc.contact_person.department_or_role,
                      doc.contact_person.phone,
                      doc.contact_person.email,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">สรุปยอดเงิน</CardTitle>
              <CardDescription>
                VAT {doc.vat_type ?? "—"} · อัตรา {vatRate}%
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-2.5">
              <SummaryRow
                label="ยอดรวมสินค้า"
                value={`${formatMoney(subtotal)} ฿`}
              />
              <SummaryRow
                label={`ส่วนลดท้ายบิล${doc.discount_text ? ` (${doc.discount_text})` : ""}`}
                value={`−${formatMoney(discountAmount)} ฿`}
                negative
              />
              <SummaryRow
                label="ยอดหลังหักส่วนลด (Net Before VAT)"
                value={`${formatMoney(netBeforeVat)} ฿`}
              />
              <SummaryRow
                label={`ภาษีมูลค่าเพิ่ม ${vatRate}%`}
                value={`${formatMoney(vatAmount)} ฿`}
              />
              <div className="border-t border-slate-200 pt-2.5">
                <SummaryRow
                  label="ยอดสุทธิ (Grand Total)"
                  value={`${formatMoney(grandTotal)} ฿`}
                  emphasize
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">รายการสินค้า</CardTitle>
            <CardDescription>
              {doc.items.length} รายการ — แสดงแบบอ่านอย่างเดียว
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                    {[
                      "#",
                      "SKU",
                      "รายละเอียด",
                      "จำนวน",
                      "หน่วย",
                      "ราคา/หน่วย",
                      "รวม",
                    ].map((heading) => (
                      <TableHead
                        key={heading}
                        className="px-4 text-xs font-semibold text-slate-500"
                      >
                        {heading}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.items.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="px-4 py-10 text-center text-sm text-slate-400"
                      >
                        ไม่มีรายการสินค้า
                      </TableCell>
                    </TableRow>
                  ) : (
                    doc.items.map((item, index) => (
                      <TableRow key={item.id}>
                        <TableCell className="px-4 text-xs tabular-nums text-slate-500">
                          {index + 1}
                        </TableCell>
                        <TableCell className="px-4 font-mono text-xs font-semibold text-slate-800">
                          {item.sku ?? "—"}
                        </TableCell>
                        <TableCell className="max-w-[18rem] px-4 text-sm text-slate-700">
                          <span className="line-clamp-2">
                            {item.description || item.product_name || "—"}
                          </span>
                        </TableCell>
                        <TableCell className="px-4 text-right text-sm tabular-nums text-slate-700">
                          {item.qty}
                        </TableCell>
                        <TableCell className="px-4 text-xs text-slate-600">
                          {item.uom_used ?? "—"}
                        </TableCell>
                        <TableCell className="px-4 text-right text-sm tabular-nums text-slate-700">
                          {formatMoney(item.unit_price)}
                        </TableCell>
                        <TableCell className="px-4 text-right text-sm font-semibold tabular-nums text-slate-900">
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

        <p className="text-center text-xs text-slate-400">
          ตัวอย่างสำหรับพิมพ์ (A4) — กด &quot;พิมพ์เอกสาร&quot; เพื่อสั่งพิมพ์เฉพาะแผ่นนี้
        </p>
      </div>

      {/* A4 print layout — preview on screen, sole content when printing */}
      <PrintDocumentTemplate document={doc} className="mt-2 print:mt-0" />
    </div>
  );
}
