import Link from "next/link";
import { getDocumentByNo } from "@/lib/actions/document-actions";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function formatMoney(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {label}
      </p>
      <div className="text-sm font-medium text-slate-900">{children}</div>
    </div>
  );
}

/**
 * Server Component — TB document preview for WHT Report slide-over.
 */
export async function WhtTbPreviewContent({
  documentId,
}: {
  documentId: string;
}) {
  const result = await getDocumentByNo(documentId);

  if (result.error || !result.data) {
    return (
      <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {result.error ?? "ไม่พบเอกสารสรุปวางบิลช่าง"}
      </div>
    );
  }

  const doc = result.data;
  if (doc.doc_type !== "TB") {
    return (
      <div className="mx-6 mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
        เอกสารนี้ไม่ใช่ประเภท TB
      </div>
    );
  }

  const grandTotal = Number(doc.grand_total ?? 0);
  const whtAmount = Number(doc.wht_amount ?? 0);
  const whtRate = Number(doc.wht_rate ?? 0);
  const wageGross = Number(
    doc.net_before_vat ?? doc.sub_total ?? grandTotal + whtAmount,
  );

  return (
    <div className="flex flex-col gap-6 px-6 pb-6 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="blue">TB</Badge>
        <Badge variant="slate">{doc.status}</Badge>
        <Badge
          variant={
            doc.payment_status.trim().toUpperCase() === "PAID"
              ? "emerald"
              : "amber"
          }
        >
          {doc.payment_status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="เลขที่เอกสาร">{doc.doc_no}</Field>
        <Field label="วันที่เอกสาร">
          {formatThaiDate(doc.doc_date, "short")}
        </Field>
        <Field label="ช่าง / ผู้รับเงิน">
          {doc.contact?.company_name?.trim() || "—"}
        </Field>
        <Field label="เลขประจำตัวผู้เสียภาษี">
          {doc.contact?.tax_id?.trim() || "—"}
        </Field>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">
          สรุปยอด
        </p>
        <div className="space-y-2 text-sm">
          <div className="flex items-center justify-between gap-3 text-slate-600">
            <span>ยอดรวมค่าแรง (Wage Gross)</span>
            <span className="tabular-nums font-medium text-slate-800">
              {formatMoney(wageGross)}
            </span>
          </div>
          {whtAmount > 0 ? (
            <div className="flex items-center justify-between gap-3 text-amber-800">
              <span>
                หัก ณ ที่จ่าย (WHT)
                {whtRate > 0 ? ` · ${whtRate}%` : ""}
              </span>
              <span className="tabular-nums font-medium">
                -{formatMoney(whtAmount)}
              </span>
            </div>
          ) : null}
          <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-2">
            <span className="font-semibold text-slate-900">
              ยอดโอนจ่ายจริง (Net Payable)
            </span>
            <span className="text-base font-bold tabular-nums text-emerald-700">
              {formatMoney(grandTotal)}
            </span>
          </div>
        </div>
      </div>

      {doc.notes?.trim() ? (
        <Field label="หมายเหตุ">
          <span className="whitespace-pre-wrap font-normal text-slate-700">
            {doc.notes.trim()}
          </span>
        </Field>
      ) : null}

      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          รายการค่าแรง ({doc.items.length})
        </p>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50/80">
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
                    className="h-16 text-center text-sm text-slate-500"
                  >
                    ไม่มีรายการ
                  </TableCell>
                </TableRow>
              ) : (
                doc.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="font-medium text-slate-900">
                        {item.description || item.product_name || "—"}
                      </div>
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
      </div>

      <p className="text-xs text-slate-400">
        ดูรายละเอียดเต็มได้ที่{" "}
        <Link
          href={`/purchases/${encodeURIComponent(doc.doc_no)}`}
          className="font-medium text-blue-600 hover:underline"
        >
          {doc.doc_no}
        </Link>
      </p>
    </div>
  );
}
