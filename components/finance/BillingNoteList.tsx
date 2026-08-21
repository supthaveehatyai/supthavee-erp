"use client";

/**
 * Billing Note listing — Client island for tabs + search URL state.
 * Rows come from Server Component parent (Zero Client-Side Fetching).
 */

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Plus, Search } from "lucide-react";
import type {
  BillingNoteDocType,
  BillingNoteListItem,
} from "@/types/billing";
import type { BillingNotesTab } from "@/types/technician-billing";
import { TechnicianBillingPanel } from "@/components/finance/TechnicianBillingPanel";
import type { TechnicianBillingPanelProps } from "@/components/finance/TechnicianBillingPanel";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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

const SEARCH_DEBOUNCE_MS = 300;

export type BillingNoteListProps = {
  type: BillingNotesTab;
  search: string;
  rows: BillingNoteListItem[];
  error: string | null;
  technicianBilling?: TechnicianBillingPanelProps;
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

function buildListHref(type: BillingNotesTab, search?: string): string {
  const params = new URLSearchParams();
  params.set("type", type);
  if (type !== "TB" && search?.trim()) params.set("search", search.trim());
  return `/finance/billing-notes?${params.toString()}`;
}

function createHref(type: BillingNoteDocType): string {
  const category = type === "BR" ? "AP" : "AR";
  return `/finance/billing-notes/create?type=${category}`;
}

function statusBadge(status: string) {
  const normalized = status.trim().toUpperCase();
  if (normalized === "PAID" || normalized === "COMPLETED") {
    return (
      <Badge className="border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-50">
        {status}
      </Badge>
    );
  }
  if (normalized === "PARTIAL") {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-50">
        {status}
      </Badge>
    );
  }
  if (normalized === "PENDING" || normalized === "UNPAID") {
    return (
      <Badge className="border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-50">
        {status}
      </Badge>
    );
  }
  return (
    <Badge className="border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-50">
      {status || "—"}
    </Badge>
  );
}

export function BillingNoteList({
  type,
  search: urlSearch,
  rows,
  error,
  technicianBilling,
}: BillingNoteListProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [search, setSearch] = useState(urlSearch);
  const latestRef = useRef({ search, urlSearch, type });
  latestRef.current = { search, urlSearch, type };

  const isBN = type === "BN";
  const isBR = type === "BR";
  const isTB = type === "TB";
  const contactColumnLabel = isBN ? "ชื่อลูกค้า" : "ชื่อคู่ค้า";

  useEffect(() => {
    setSearch(urlSearch);
  }, [urlSearch]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      const latest = latestRef.current;
      if (latest.type === "TB") return;
      if (latest.search.trim() === latest.urlSearch.trim()) return;
      startTransition(() => {
        router.replace(buildListHref(latest.type, latest.search), {
          scroll: false,
        });
      });
    }, SEARCH_DEBOUNCE_MS);

    return () => window.clearTimeout(handle);
  }, [search, router, startTransition]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
            <FileSpreadsheet className="h-8 w-8 text-blue-600" />
            ระบบวางบิล (Billing Note)
          </h1>
          <p className="text-slate-500">
            วางบิลลูกหนี้ (BN) · รับวางบิลเจ้าหนี้ (BR) · สรุปวางบิลช่าง (TB)
          </p>
        </div>
        {isTB ? null : (
          <Link
            href={createHref(isBN ? "BN" : "BR")}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700"
          >
            <Plus className="size-4" />
            สร้างใบวางบิล
          </Link>
        )}
      </div>

      <div
        role="tablist"
        className="inline-flex h-10 w-full max-w-3xl items-center justify-center rounded-xl bg-slate-100 p-1 text-slate-600"
      >
        <Link
          role="tab"
          aria-selected={isBN}
          href={buildListHref("BN", urlSearch)}
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-semibold transition sm:px-3",
            isBN
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          วางบิลลูกหนี้ (BN)
        </Link>
        <Link
          role="tab"
          aria-selected={isBR}
          href={buildListHref("BR", urlSearch)}
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-semibold transition sm:px-3",
            isBR
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          รับวางบิลเจ้าหนี้ (BR)
        </Link>
        <Link
          role="tab"
          aria-selected={isTB}
          href={buildListHref("TB")}
          className={cn(
            "inline-flex flex-1 items-center justify-center whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-semibold transition sm:px-3",
            isTB
              ? "bg-white text-slate-900 shadow-sm"
              : "text-slate-600 hover:text-slate-900",
          )}
        >
          สรุปวางบิลช่าง (TB)
        </Link>
      </div>

      {isTB && technicianBilling ? (
        <TechnicianBillingPanel {...technicianBilling} />
      ) : isTB ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          ไม่สามารถโหลดรายการสรุปวางบิลช่างได้
        </div>
      ) : (
        <Card>
        <CardHeader className="gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>
              {isBN ? "รายการวางบิลลูกหนี้" : "รายการรับวางบิลเจ้าหนี้"}
            </CardTitle>
            <CardDescription>
              พบ {rows.length} รายการ
              {urlSearch ? ` · ค้นหา “${urlSearch}”` : null}
            </CardDescription>
          </div>
          <div className="relative w-full sm:max-w-xs">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาเลขที่เอกสาร / ชื่อคู่ค้า"
              className="h-10 pl-9"
              aria-label="ค้นหารายการวางบิล"
            />
          </div>
        </CardHeader>
        <CardContent>
          {error ? (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {rows.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-12 text-center text-sm text-slate-500">
              {urlSearch
                ? "ไม่พบรายการที่ตรงกับการค้นหา"
                : isBN
                  ? "ยังไม่มีใบวางบิลลูกหนี้ (BN)"
                  : "ยังไม่มีใบรับวางบิลเจ้าหนี้ (BR)"}
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50">
                    <TableHead className="whitespace-nowrap">
                      วันที่เอกสาร
                    </TableHead>
                    <TableHead className="whitespace-nowrap">
                      เลขที่เอกสาร
                    </TableHead>
                    <TableHead>{contactColumnLabel}</TableHead>
                    <TableHead className="whitespace-nowrap">
                      วันครบกำหนด
                    </TableHead>
                    <TableHead className="whitespace-nowrap text-right">
                      ยอดรวม
                    </TableHead>
                    <TableHead className="whitespace-nowrap">สถานะ</TableHead>
                    <TableHead className="whitespace-nowrap text-right print:hidden">
                      การดำเนินการ
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap text-slate-700">
                        {formatDate(row.doc_date)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap font-mono text-sm font-semibold text-slate-900">
                        <Link
                          href={`/finance/billing-notes/${row.id}`}
                          className="text-blue-700 underline-offset-2 hover:underline"
                        >
                          {row.doc_no}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-slate-700">
                        {row.contact_name}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-slate-700">
                        {formatDate(row.due_date)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-slate-900">
                        ฿{formatMoney(row.grand_total)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        {statusBadge(row.payment_status)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right print:hidden">
                        <Link
                          href={`/finance/billing-notes/${row.id}`}
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
          )}
        </CardContent>
      </Card>
      )}
    </div>
  );
}
