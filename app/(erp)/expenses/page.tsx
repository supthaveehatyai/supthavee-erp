import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Receipt } from "lucide-react";
import { getExpenses } from "@/app/actions/expenses";
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
  title: "ค่าใช้จ่าย | Expenses",
  description: "รายการค่าใช้จ่ายดำเนินงาน (OPEX)",
};

function formatThaiBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}

/** Document Date — calendar date only (expense_date / bill date). */
function formatDocDate(value: string): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Posting Date — created_at with time (dd MMM yyyy HH:mm). */
function formatPostingDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

function StatusBadge({ status }: { status: string }) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "ISSUED") {
    return <Badge variant="emerald">ISSUED</Badge>;
  }
  if (normalized === "PAID") {
    return <Badge variant="emerald">ชำระครบแล้ว (PAID)</Badge>;
  }
  if (normalized === "VOID") {
    return (
      <Badge variant="amber" className="bg-red-100 text-red-700">
        VOID
      </Badge>
    );
  }
  return <Badge variant="slate">DRAFT</Badge>;
}

export default async function ExpensesPage() {
  const { data: expenses, error } = await getExpenses();

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <Receipt className="h-8 w-8 text-blue-600" />
            ค่าใช้จ่าย (Expenses)
          </h1>
          <p className="text-slate-500">
            รายการค่าใช้จ่ายดำเนินงาน — Phase 8 Expense Management (Zero
            Client-Side Fetching)
          </p>
        </div>

        <Link
          href="/expenses/create"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        >
          <Plus className="h-4 w-4" />
          เพิ่มค่าใช้จ่าย (+)
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ไม่สามารถโหลดรายการค่าใช้จ่ายได้: {error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">รายการค่าใช้จ่าย</CardTitle>
          <CardDescription>
            เรียงตามวันที่บันทึก (Posting Date) · แยกจากวันที่บิล (Doc Date) ·
            Server Action + supabaseAdmin
          </CardDescription>
        </CardHeader>
        <CardContent>
          {expenses.length === 0 ? (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-500">
              ยังไม่มีรายการค่าใช้จ่าย — กด &quot;เพิ่มค่าใช้จ่าย (+)&quot;
              เพื่อเริ่มบันทึก
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="whitespace-nowrap">
                      วันที่บันทึก
                      <span className="mt-0.5 block text-[10px] font-normal text-slate-400">
                        Posting Date
                      </span>
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      วันที่บิล
                      <span className="mt-0.5 block text-[10px] font-normal text-slate-400">
                        Doc Date
                      </span>
                    </TableHead>
                    <TableHead>Document No</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead>Remark</TableHead>
                    <TableHead className="text-center">Status</TableHead>
                    <TableHead className="text-right">Grand Total</TableHead>
                    <TableHead className="text-center">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {expenses.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-sm font-medium tabular-nums text-slate-900">
                        {formatPostingDate(row.created_at)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm tabular-nums text-slate-600">
                        {formatDocDate(row.expense_date)}
                      </TableCell>
                      <TableCell>
                        <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700">
                          {row.document_no || "—"}
                        </code>
                      </TableCell>
                      <TableCell className="text-sm font-medium text-slate-900">
                        {row.category_name}
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate text-sm text-slate-500">
                        {row.remark?.trim() || "—"}
                      </TableCell>
                      <TableCell className="text-center">
                        <StatusBadge status={row.status} />
                      </TableCell>
                      <TableCell className="text-right text-sm font-semibold tabular-nums text-slate-900">
                        {formatThaiBaht(row.grand_total)}
                      </TableCell>
                      <TableCell className="text-center">
                        <Link
                          href={`/expenses/${row.id}`}
                          className="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                        >
                          ดูรายละเอียด
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
