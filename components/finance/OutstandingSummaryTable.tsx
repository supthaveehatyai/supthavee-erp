"use client";

/**
 * Shared Outstanding Summary table — sortable party list or selected bills.
 * Used by REC, AR Write-off, and AP Write-off (client island only).
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from "lucide-react";

export type OutstandingPartyRow = {
  id: string;
  name: string;
  outstanding_total: number;
  invoice_count: number;
  overdue_amount?: number;
  oldest_invoice_date: string | null;
};

export type OutstandingBillRow = {
  id: string;
  display_doc_no: string;
  document_date: string;
  doc_type: string;
  net_amount_calc: number;
  remaining_balance: number;
};

type SortDirection = "asc" | "desc";
type PartySortKey = "name" | "amount" | "oldest_date";
type BillSortKey = "doc_no" | "doc_date" | "remaining_amount";

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function SortArrow({
  active,
  direction,
}: {
  active: boolean;
  direction: SortDirection;
}) {
  if (!active) {
    return <ArrowUpDown className="h-3.5 w-3.5 text-slate-300" />;
  }
  return direction === "asc" ? (
    <ArrowUp className="h-3.5 w-3.5 text-blue-600" />
  ) : (
    <ArrowDown className="h-3.5 w-3.5 text-blue-600" />
  );
}

function headerButtonClass(active: boolean, alignRight?: boolean): string {
  return cn(
    "inline-flex items-center gap-1.5 font-semibold uppercase tracking-wide",
    alignRight ? "ml-auto" : null,
    active ? "text-blue-700" : "text-slate-400 hover:text-slate-600",
  );
}

function ariaSort(
  active: boolean,
  direction: SortDirection,
): "ascending" | "descending" | "none" {
  if (!active) return "none";
  return direction === "asc" ? "ascending" : "descending";
}

const PARTY_PRESETS: Array<{
  value: `${PartySortKey}-${SortDirection}`;
  label: string;
}> = [
  { value: "amount-desc", label: "เรียงตามยอดหนี้สูงสุด" },
  { value: "amount-asc", label: "เรียงตามยอดหนี้ต่ำสุด" },
  { value: "oldest_date-asc", label: "เรียงตามบิลเก่าสุด" },
  { value: "oldest_date-desc", label: "เรียงตามบิลใหม่สุด" },
];

const BILL_PRESETS: Array<{
  value: `${BillSortKey}-${SortDirection}`;
  label: string;
}> = [
  { value: "doc_date-asc", label: "เรียงตามบิลเก่าสุด" },
  { value: "remaining_amount-desc", label: "เรียงตามยอดคงเหลือสูงสุด" },
  { value: "doc_no-asc", label: "เรียงตามเลขที่เอกสาร" },
];

function compareParties(
  a: OutstandingPartyRow,
  b: OutstandingPartyRow,
  key: PartySortKey,
  direction: SortDirection,
): number {
  const dir = direction === "asc" ? 1 : -1;
  if (key === "name") {
    return a.name.localeCompare(b.name, "th", { sensitivity: "base" }) * dir;
  }
  if (key === "amount") {
    const diff = a.outstanding_total - b.outstanding_total;
    if (diff !== 0) return diff * dir;
    return a.name.localeCompare(b.name, "th", { sensitivity: "base" });
  }
  const aDate = a.oldest_invoice_date?.trim() ?? "";
  const bDate = b.oldest_invoice_date?.trim() ?? "";
  if (!aDate && !bDate) {
    return a.name.localeCompare(b.name, "th", { sensitivity: "base" });
  }
  if (!aDate) return 1;
  if (!bDate) return -1;
  const dateDiff = aDate.localeCompare(bDate);
  if (dateDiff !== 0) return dateDiff * dir;
  return a.name.localeCompare(b.name, "th", { sensitivity: "base" });
}

function compareBills(
  a: OutstandingBillRow,
  b: OutstandingBillRow,
  key: BillSortKey,
  direction: SortDirection,
): number {
  const dir = direction === "asc" ? 1 : -1;
  if (key === "doc_no") {
    const cmp = a.display_doc_no.localeCompare(b.display_doc_no, "th", {
      numeric: true,
      sensitivity: "base",
    });
    if (cmp !== 0) return cmp * dir;
  } else if (key === "remaining_amount") {
    const diff = a.remaining_balance - b.remaining_balance;
    if (diff !== 0) return diff * dir;
  } else {
    const aDate = a.document_date?.trim() ?? "";
    const bDate = b.document_date?.trim() ?? "";
    if (!aDate && !bDate) {
      return a.display_doc_no.localeCompare(b.display_doc_no, "th", {
        numeric: true,
        sensitivity: "base",
      });
    }
    if (!aDate) return 1;
    if (!bDate) return -1;
    const dateDiff = aDate.localeCompare(bDate);
    if (dateDiff !== 0) return dateDiff * dir;
  }
  return a.display_doc_no.localeCompare(b.display_doc_no, "th", {
    numeric: true,
    sensitivity: "base",
  });
}

export type OutstandingPartyTableProps = {
  mode: "parties";
  rows: OutstandingPartyRow[];
  partyLabel: string;
  emptyMessage: string;
  selectHref: (id: string) => string;
  selectLabel?: string;
  showOverdue?: boolean;
  nameAscLabel?: string;
  nameDescLabel?: string;
  sortSelectId?: string;
};

export type OutstandingBillTableProps = {
  mode: "invoices";
  rows: OutstandingBillRow[];
  amounts: Record<string, string>;
  onAmountChange: (id: string, value: string) => void;
  lineErrors?: Record<string, string>;
  documentHref: (docNo: string) => string;
  totalWriteoff: number;
  disabled?: boolean;
  sortSelectId?: string;
};

export type OutstandingSummaryTableProps =
  | OutstandingPartyTableProps
  | OutstandingBillTableProps;

function PartyTable({
  rows,
  partyLabel,
  emptyMessage,
  selectHref,
  selectLabel = "เลือก",
  showOverdue = false,
  nameAscLabel = "เรียงตามชื่อ (ก–ฮ)",
  nameDescLabel = "เรียงตามชื่อ (ฮ–ก)",
  sortSelectId = "outstanding-party-sort",
}: Omit<OutstandingPartyTableProps, "mode">) {
  const [key, setKey] = useState<PartySortKey>("amount");
  const [direction, setDirection] = useState<SortDirection>("desc");

  const presets = [
    ...PARTY_PRESETS,
    { value: "name-asc" as const, label: nameAscLabel },
    { value: "name-desc" as const, label: nameDescLabel },
  ];

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareParties(a, b, key, direction)),
    [rows, key, direction],
  );

  function toggle(next: PartySortKey) {
    if (key === next) {
      setDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setKey(next);
    setDirection(next === "amount" ? "desc" : "asc");
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 py-10 text-center text-slate-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Label
          htmlFor={sortSelectId}
          className="text-xs font-medium text-slate-500"
        >
          เรียงลำดับด่วน
        </Label>
        <select
          id={sortSelectId}
          className="h-9 min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          value={`${key}-${direction}`}
          onChange={(e) => {
            const [nextKey, nextDir] = e.target.value.split("-") as [
              PartySortKey,
              SortDirection,
            ];
            setKey(nextKey);
            setDirection(nextDir);
          }}
        >
          {presets.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-hidden rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead aria-sort={ariaSort(key === "name", direction)}>
                <button
                  type="button"
                  className={headerButtonClass(key === "name")}
                  onClick={() => toggle("name")}
                >
                  {partyLabel}
                  <SortArrow active={key === "name"} direction={direction} />
                </button>
              </TableHead>
              <TableHead className="text-center">จำนวนบิลค้าง</TableHead>
              <TableHead
                className="text-right"
                aria-sort={ariaSort(key === "amount", direction)}
              >
                <button
                  type="button"
                  className={headerButtonClass(key === "amount", true)}
                  onClick={() => toggle("amount")}
                >
                  ยอดหนี้รวม
                  <SortArrow active={key === "amount"} direction={direction} />
                </button>
              </TableHead>
              {showOverdue ? (
                <TableHead className="text-right">ยอดเกินกำหนด</TableHead>
              ) : null}
              <TableHead aria-sort={ariaSort(key === "oldest_date", direction)}>
                <button
                  type="button"
                  className={headerButtonClass(key === "oldest_date")}
                  onClick={() => toggle("oldest_date")}
                >
                  บิลเก่าสุด
                  <SortArrow
                    active={key === "oldest_date"}
                    direction={direction}
                  />
                </button>
              </TableHead>
              <TableHead className="text-center">จัดการ</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium text-slate-900">
                  {row.name}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="slate">{row.invoice_count} บิล</Badge>
                </TableCell>
                <TableCell className="text-right font-bold text-red-600">
                  {formatMoney(row.outstanding_total)}
                </TableCell>
                {showOverdue ? (
                  <TableCell
                    className={
                      (row.overdue_amount ?? 0) > 0
                        ? "text-right font-semibold text-red-600"
                        : "text-right text-slate-400"
                    }
                  >
                    {formatMoney(row.overdue_amount ?? 0)}
                  </TableCell>
                ) : null}
                <TableCell className="text-slate-600">
                  {row.oldest_invoice_date
                    ? formatThaiDate(row.oldest_invoice_date, "short")
                    : "—"}
                </TableCell>
                <TableCell className="text-center">
                  <Link
                    href={selectHref(row.id)}
                    className="inline-flex h-8 items-center justify-center rounded-xl bg-blue-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700"
                  >
                    {selectLabel}
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function InvoiceTable({
  rows,
  amounts,
  onAmountChange,
  lineErrors = {},
  documentHref,
  totalWriteoff,
  disabled = false,
  sortSelectId = "outstanding-bill-sort",
}: Omit<OutstandingBillTableProps, "mode">) {
  const [key, setKey] = useState<BillSortKey>("doc_date");
  const [direction, setDirection] = useState<SortDirection>("asc");

  const sorted = useMemo(
    () => [...rows].sort((a, b) => compareBills(a, b, key, direction)),
    [rows, key, direction],
  );

  function toggle(next: BillSortKey) {
    if (key === next) {
      setDirection((prev) => (prev === "asc" ? "desc" : "asc"));
      return;
    }
    setKey(next);
    setDirection(next === "remaining_amount" ? "desc" : "asc");
  }

  function parseAmount(raw: string): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.round((n + Number.EPSILON) * 100) / 100;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Label
          htmlFor={sortSelectId}
          className="text-xs font-medium text-slate-500"
        >
          เรียงลำดับด่วน
        </Label>
        <select
          id={sortSelectId}
          className="h-9 min-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
          value={`${key}-${direction}`}
          disabled={disabled}
          onChange={(e) => {
            const [nextKey, nextDir] = e.target.value.split("-") as [
              BillSortKey,
              SortDirection,
            ];
            setKey(nextKey);
            setDirection(nextDir);
          }}
        >
          {BILL_PRESETS.map((preset) => (
            <option key={preset.value} value={preset.value}>
              {preset.label}
            </option>
          ))}
        </select>
      </div>
      <div className="overflow-hidden rounded-md border border-slate-200">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
              <TableHead aria-sort={ariaSort(key === "doc_no", direction)}>
                <button
                  type="button"
                  className={headerButtonClass(key === "doc_no")}
                  onClick={() => toggle("doc_no")}
                >
                  เลขที่เอกสาร
                  <SortArrow active={key === "doc_no"} direction={direction} />
                </button>
              </TableHead>
              <TableHead aria-sort={ariaSort(key === "doc_date", direction)}>
                <button
                  type="button"
                  className={headerButtonClass(key === "doc_date")}
                  onClick={() => toggle("doc_date")}
                >
                  วันที่
                  <SortArrow
                    active={key === "doc_date"}
                    direction={direction}
                  />
                </button>
              </TableHead>
              <TableHead className="text-right">มูลค่าบิล</TableHead>
              <TableHead
                className="text-right"
                aria-sort={ariaSort(key === "remaining_amount", direction)}
              >
                <button
                  type="button"
                  className={headerButtonClass(key === "remaining_amount", true)}
                  onClick={() => toggle("remaining_amount")}
                >
                  ยอดคงเหลือ
                  <SortArrow
                    active={key === "remaining_amount"}
                    direction={direction}
                  />
                </button>
              </TableHead>
              <TableHead className="text-right">ยอดที่ต้องการตัดหนี้</TableHead>
              <TableHead className="text-center">ดูบิล</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((inv) => {
              const raw = amounts[inv.id] ?? "";
              const amount = parseAmount(raw);
              const hasError = Boolean(lineErrors[inv.id]);
              const docHref = documentHref(inv.display_doc_no);
              return (
                <TableRow
                  key={inv.id}
                  className={
                    hasError
                      ? "bg-red-50/40"
                      : amount > 0
                        ? "bg-blue-50/40"
                        : undefined
                  }
                >
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={docHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-blue-700 underline-offset-2 hover:underline"
                      >
                        {inv.display_doc_no}
                      </a>
                      <Badge variant="slate">{inv.doc_type}</Badge>
                    </div>
                  </TableCell>
                  <TableCell>
                    {inv.document_date
                      ? formatThaiDate(inv.document_date, "short")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right text-slate-500">
                    {formatMoney(inv.net_amount_calc)}
                  </TableCell>
                  <TableCell className="text-right font-semibold text-red-600">
                    {formatMoney(inv.remaining_balance)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      max={inv.remaining_balance}
                      disabled={disabled}
                      className="ml-auto h-9 w-36 text-right"
                      value={raw}
                      placeholder="0.00"
                      aria-invalid={hasError}
                      onChange={(e) => onAmountChange(inv.id, e.target.value)}
                    />
                    {hasError ? (
                      <p className="mt-1 text-xs text-destructive">
                        ไม่เกิน {formatMoney(inv.remaining_balance)}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-center">
                    <a
                      href={docHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                    >
                      <Eye className="h-3.5 w-3.5" />
                      ดูบิล
                    </a>
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="bg-slate-50/80">
              <TableCell
                colSpan={4}
                className="text-right text-sm font-semibold text-slate-700"
              >
                ยอดรวมตัดหนี้ (Total Write-off Amount)
              </TableCell>
              <TableCell className="text-right text-sm font-bold tabular-nums text-blue-800">
                {formatMoney(totalWriteoff)}
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export function OutstandingSummaryTable(props: OutstandingSummaryTableProps) {
  if (props.mode === "parties") {
    const { mode: _mode, ...partyProps } = props;
    void _mode;
    return <PartyTable {...partyProps} />;
  }
  const { mode: _mode, ...invoiceProps } = props;
  void _mode;
  return <InvoiceTable {...invoiceProps} />;
}
