import Link from "next/link";
import { getDocumentPreview } from "@/lib/actions/document-preview";
import { isFinanceHeaderOnlyDocType } from "@/lib/constants/document";
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
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
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
 * Server Component — fetch document header + items/allocations for the
 * Approval Center slide-over. Zero Client-Side Fetching.
 */
export async function DocumentPreviewContent({
  documentId,
}: {
  documentId: string;
}) {
  const result = await getDocumentPreview(documentId);

  if (result.error || !result.data) {
    return (
      <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {result.error ?? "ไม่พบเอกสาร"}
      </div>
    );
  }

  const doc = result.data;
  const isFinanceDoc = isFinanceHeaderOnlyDocType(doc.doc_type);
  const remarkText = doc.remark?.trim() || "";

  return (
    <div className="flex flex-col gap-6 px-6 pb-8 pt-2">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="slate" className="font-mono">
          {doc.doc_type}
        </Badge>
        <Badge variant="slate">{doc.status}</Badge>
        <Badge
          variant={doc.approval_status === "PENDING" ? "amber" : "emerald"}
        >
          {doc.approval_status}
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="เลขที่เอกสาร">
          <span className="font-mono">{doc.doc_no}</span>
        </Field>
        <Field label="วันที่เอกสาร">
          {doc.doc_date ? formatThaiDate(doc.doc_date, "short") : "—"}
        </Field>
        <Field label="คู่ค้า">{doc.contact_name || "—"}</Field>
        <Field label="ยอดเงิน (Grand Total)">
          <span className="text-base font-semibold tabular-nums text-blue-700">
            {formatMoney(doc.grand_total)} ฿
          </span>
        </Field>
      </div>

      <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-800">
          หมายเหตุ (Remark)
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm font-semibold leading-relaxed text-amber-950">
          {remarkText || "— ไม่มีหมายเหตุ —"}
        </p>
      </div>

      {doc.allocations.length > 0 ? (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            รายการเอกสารที่ถูกตัดหนี้
          </p>
          <div className="overflow-hidden rounded-md border border-slate-200">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50">
                  <TableHead>เลขที่เอกสาร</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead className="text-right">ยอดที่ตัด</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {doc.allocations.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell className="font-mono text-sm">
                      {row.target_doc_no}
                    </TableCell>
                    <TableCell>
                      <Badge variant="slate">{row.target_doc_type || "—"}</Badge>
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatMoney(row.allocated_amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      ) : isFinanceDoc ? (
        <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          ไม่พบรายการเอกสารที่ตัดหนี้
        </p>
      ) : null}

      {!isFinanceDoc ? (
        <div className="space-y-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            รายการสินค้า
          </p>
          {doc.items.length === 0 ? (
            <p className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
              ไม่มีรายการสินค้า
            </p>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead>รายการ</TableHead>
                    <TableHead className="text-right">จำนวน</TableHead>
                    <TableHead className="text-right">ราคา/หน่วย</TableHead>
                    <TableHead className="text-right">รวม</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {doc.items.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>{row.description?.trim() || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.qty}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(row.unit_price)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatMoney(row.line_total)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      ) : null}

      <p className="text-xs text-slate-500">
        เปิดเอกสารเต็มรูปแบบได้ที่{" "}
        <Link
          href={doc.detail_href}
          className="font-medium text-blue-700 underline-offset-2 hover:underline"
        >
          {doc.doc_no}
        </Link>
      </p>
    </div>
  );
}
