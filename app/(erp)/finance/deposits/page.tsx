import type { Metadata } from "next";
import Link from "next/link";
import { HandCoins, Plus, Wallet } from "lucide-react";
import { getDepositDocuments } from "@/app/actions/finance/deposit-actions";
import type { DepositDocument, DepositTab } from "@/types/deposit";
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
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "เงินมัดจำ | Deposit Management",
  description: "ระบบรับและจ่ายเงินมัดจำ (DEP_IN / DEP_OUT)",
};

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<{
    tab?: string;
    search?: string;
  }>;
};

function resolveTab(raw: string | undefined): DepositTab {
  return raw === "DEP_OUT" ? "DEP_OUT" : "DEP_IN";
}

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

function statusBadge(label: string) {
  if (label === "นำไปตัดชำระครบแล้ว") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
        {label}
      </Badge>
    );
  }
  if (label === "ตัดชำระบางส่วน") {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
        {label}
      </Badge>
    );
  }
  return (
    <Badge className="border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-50">
      {label}
    </Badge>
  );
}

function buildTabHref(tab: DepositTab, search?: string): string {
  const params = new URLSearchParams();
  params.set("tab", tab);
  if (search?.trim()) params.set("search", search.trim());
  return `/finance/deposits?${params.toString()}`;
}

function DepositTable({
  rows,
  emptyLabel,
  detailBasePath,
}: {
  rows: DepositDocument[];
  emptyLabel: string;
  detailBasePath: "/sales" | "/purchases";
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-slate-500">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-md border border-slate-200">
      <Table>
        <TableHeader>
          <TableRow className="bg-slate-50">
            <TableHead className="whitespace-nowrap">วันที่</TableHead>
            <TableHead className="whitespace-nowrap">เลขที่เอกสาร</TableHead>
            <TableHead>ชื่อผู้ติดต่อ</TableHead>
            <TableHead className="whitespace-nowrap text-right">
              ยอดรวม (Grand Total)
            </TableHead>
            <TableHead className="whitespace-nowrap text-right">
              ยอดคงเหลือ (Balance)
            </TableHead>
            <TableHead className="whitespace-nowrap">สถานะ</TableHead>
            <TableHead className="whitespace-nowrap text-right">
              การดำเนินการ
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((doc) => (
            <TableRow key={doc.id}>
              <TableCell className="whitespace-nowrap text-slate-700">
                {formatDate(doc.document_date || doc.created_at)}
              </TableCell>
              <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-900">
                {doc.doc_no}
              </TableCell>
              <TableCell className="max-w-[240px] truncate text-slate-700">
                {doc.contact_name}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-slate-900">
                ฿{formatMoney(doc.grand_total)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums text-emerald-700">
                ฿{formatMoney(doc.available_amount)}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                {statusBadge(doc.status_label)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right">
                <Link
                  href={`${detailBasePath}/${encodeURIComponent(doc.doc_no)}`}
                  className="inline-flex h-8 items-center justify-center rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                >
                  ดูรายละเอียด
                </Link>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function DepositsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const tab = resolveTab(params.tab);
  const search = params.search?.trim() || undefined;

  const { data, error } = await getDepositDocuments(tab, search);

  const totalAmount = data.reduce((sum, row) => sum + row.grand_total, 0);
  const totalAvailable = data.reduce(
    (sum, row) => sum + row.available_amount,
    0,
  );
  const pendingCount = data.filter(
    (row) => row.status_label === "รอนำไปตัดชำระ",
  ).length;

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <HandCoins className="h-8 w-8 text-blue-600" />
            เงินมัดจำ (Deposit Management)
          </h1>
          <p className="text-slate-500">
            รับเงินมัดจำลูกค้า (DEP_IN) และจ่ายมัดจำซัพพลายเออร์ (DEP_OUT) —
            สถานะแท็บควบคุมผ่าน URL Search Params
          </p>
        </div>
        <Link
          href={`/finance/deposits/create?type=${tab}`}
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
        >
          <Plus className="size-4" />
          สร้างเอกสารมัดจำ
        </Link>
      </div>

      {/* URL-driven tabs — Server Component safe (no client tab state) */}
      <div
        role="tablist"
        className="inline-flex h-10 w-full max-w-xl items-center justify-center rounded-xl bg-slate-100 p-1 text-slate-600"
      >
        <Link
          role="tab"
          aria-selected={tab === "DEP_IN"}
          href={buildTabHref("DEP_IN", search)}
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            tab === "DEP_IN"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          รับเงินมัดจำลูกค้า (DEP_IN)
        </Link>
        <Link
          role="tab"
          aria-selected={tab === "DEP_OUT"}
          href={buildTabHref("DEP_OUT", search)}
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-semibold transition",
            tab === "DEP_OUT"
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          จ่ายเงินมัดจำซัพพลายเออร์ (DEP_OUT)
        </Link>
      </div>

      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card
          className={
            tab === "DEP_IN"
              ? "border-blue-200 bg-blue-50/50"
              : "border-amber-200 bg-amber-50/50"
          }
        >
          <CardContent className="flex items-center gap-4 p-6">
            <div
              className={cn(
                "rounded-full p-4",
                tab === "DEP_IN"
                  ? "bg-blue-100 text-blue-700"
                  : "bg-amber-100 text-amber-800",
              )}
            >
              <Wallet className="h-6 w-6" />
            </div>
            <div>
              <p
                className={cn(
                  "text-sm font-medium",
                  tab === "DEP_IN" ? "text-blue-600" : "text-amber-700",
                )}
              >
                จำนวนเอกสารมัดจำ
              </p>
              <h2
                className={cn(
                  "text-3xl font-bold",
                  tab === "DEP_IN" ? "text-blue-900" : "text-amber-950",
                )}
              >
                {data.length} รายการ
              </h2>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-200 bg-slate-50/50">
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-full bg-slate-100 p-4 text-slate-700">
              <HandCoins className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-600">
                ยอดคงเหลือใช้ได้ · รอตัดชำระ {pendingCount} รายการ
              </p>
              <h2 className="text-3xl font-bold text-emerald-800">
                ฿{formatMoney(totalAvailable)}
              </h2>
              <p className="mt-1 text-xs text-slate-500">
                ยอดรวมทั้งหมด ฿{formatMoney(totalAmount)}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            {tab === "DEP_IN"
              ? "รายการรับเงินมัดจำลูกค้า"
              : "รายการจ่ายเงินมัดจำซัพพลายเออร์"}
          </CardTitle>
          <CardDescription>
            แสดงยอดรวมและยอดคงเหลือ (grand_total − allocated จาก
            document_allocations)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <DepositTable
            rows={data}
            emptyLabel={
              search
                ? "ไม่พบเอกสารมัดจำที่ตรงกับเงื่อนไขการค้นหา"
                : tab === "DEP_IN"
                  ? "ยังไม่มีเอกสารรับเงินมัดจำลูกค้า (DEP_IN)"
                  : "ยังไม่มีเอกสารจ่ายเงินมัดจำซัพพลายเออร์ (DEP_OUT)"
            }
            detailBasePath={tab === "DEP_IN" ? "/sales" : "/purchases"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
