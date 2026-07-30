/**
 * Deposit Allocation History — presentational table for DEP_IN / DEP_OUT detail.
 * Supports APPLY (REC/PAY knock-off), REFUND, and WRITE_OFF rows.
 */

import Link from "next/link";
import type { DepositAllocationHistoryRow } from "@/types/document-allocation";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type DepositAllocationHistoryTableProps = {
  rows: DepositAllocationHistoryRow[];
  /** Base path for REC/PAY links — sales for DEP_IN, purchases for DEP_OUT. */
  receiptBasePath: "/sales" | "/purchases";
  /** Base path for related invoice links. */
  invoiceBasePath: "/sales" | "/purchases";
  error?: string | null;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function actionBadge(row: DepositAllocationHistoryRow) {
  if (row.action_type === "REFUND") {
    return (
      <Badge
        variant="slate"
        className="border-sky-200 bg-sky-50 font-semibold text-sky-800"
      >
        คืนเงิน
      </Badge>
    );
  }
  if (row.action_type === "WRITE_OFF") {
    return (
      <Badge
        variant="slate"
        className="border-amber-200 bg-amber-50 font-semibold text-amber-800"
      >
        ตัดเศษบัญชี
      </Badge>
    );
  }
  return (
    <Badge
      variant="slate"
      className="border-emerald-200 bg-emerald-50 font-semibold text-emerald-800"
    >
      ตัดชำระ
    </Badge>
  );
}

export function DepositAllocationHistoryTable({
  rows,
  receiptBasePath,
  invoiceBasePath,
  error,
}: DepositAllocationHistoryTableProps) {
  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-sm text-slate-500">
        ยังไม่มีการนำมัดจำใบนี้ไปตัดชำระ / คืนเงิน / ตัดเศษ
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead>วันที่</TableHead>
            <TableHead>ประเภท</TableHead>
            <TableHead>เลขที่อ้างอิง</TableHead>
            <TableHead>เอกสารอ้างอิง / หมายเหตุ</TableHead>
            <TableHead className="text-right">ยอด</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isSettlement =
              row.action_type === "REFUND" || row.action_type === "WRITE_OFF";
            const amountClass =
              row.action_type === "REFUND"
                ? "text-sky-700"
                : row.action_type === "WRITE_OFF"
                  ? "text-amber-700"
                  : "text-emerald-700";

            return (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-slate-700">
                  {formatDate(row.applied_date)}
                </TableCell>
                <TableCell>{actionBadge(row)}</TableCell>
                <TableCell>
                  <Link
                    href={`${receiptBasePath}/${encodeURIComponent(row.receipt_doc_no)}`}
                    className="font-mono text-sm font-semibold text-blue-700 underline-offset-2 hover:underline"
                  >
                    {row.receipt_doc_no}
                  </Link>
                  {row.receipt_doc_type ? (
                    <span className="ml-1.5 text-xs text-slate-400">
                      ({row.receipt_doc_type})
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  {isSettlement ? (
                    <span className="text-sm text-slate-600">
                      {row.remark?.trim() ||
                        (row.action_type === "REFUND"
                          ? "คืนเงินมัดจำ"
                          : "ตัดเศษบัญชีมัดจำ")}
                    </span>
                  ) : row.related_invoice_doc_nos.length === 0 ? (
                    <span className="text-slate-400">—</span>
                  ) : (
                    <div className="flex flex-wrap gap-x-2 gap-y-1">
                      {row.related_invoice_doc_nos.map((docNo) => (
                        <Link
                          key={docNo}
                          href={`${invoiceBasePath}/${encodeURIComponent(docNo)}`}
                          className="font-mono text-xs font-medium text-slate-700 underline-offset-2 hover:underline"
                        >
                          {docNo}
                        </Link>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell
                  className={`whitespace-nowrap text-right font-semibold tabular-nums ${amountClass}`}
                >
                  ฿{formatMoney(row.allocated_amount)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
