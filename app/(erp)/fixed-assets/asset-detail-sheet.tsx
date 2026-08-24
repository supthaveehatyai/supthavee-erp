"use client";

/**
 * Fixed Asset Detail — URL-driven slide-over (`?view_asset_id=`).
 * Data is fetched on the Server and passed in (Zero Client-Side Fetching).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Building2, ExternalLink, ScrollText } from "lucide-react";
import type { AssetDepreciationLedgerRow } from "@/types/depreciation";
import type { FixedAssetListItem } from "@/types/fixed-assets";
import { FIXED_ASSET_STATUS_LABELS } from "@/types/fixed-assets";
import { formatAccountingPeriodLabel } from "@/types/accounting-period";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type AssetDetailSheetProps = {
  asset: FixedAssetListItem | null;
  error: string | null;
  /** URL without `view_asset_id` — preserves filters and other params */
  closeHref: string;
  depreciationLedger?: AssetDepreciationLedgerRow[];
  depreciationLedgerError?: string | null;
};

function formatThaiBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
  }).format(Number.isFinite(value) ? value : 0);
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0);
}

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

/** DATE → DD/MM/YYYY (calendar year, no timezone shift) */
function formatDdMmYyyy(value: string): string {
  const iso = String(value ?? "").slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match) return `${match[3]}/${match[2]}/${match[1]}`;
  return value || "—";
}

function formatPeriodCell(
  year: number | null,
  month: number | null,
): string {
  if (year == null || month == null) return "—";
  return formatAccountingPeriodLabel(year, month);
}

function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
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

function DepreciationLedgerSection({
  rows,
  error,
}: {
  rows: AssetDepreciationLedgerRow[];
  error: string | null;
}) {
  return (
    <section className="space-y-3 border-t border-slate-100 pt-5">
      <div className="flex items-center gap-2">
        <ScrollText className="h-4 w-4 text-blue-600" />
        <h3 className="text-sm font-semibold text-slate-900">
          ประวัติการตัดค่าเสื่อมราคา (Depreciation Ledger)
        </h3>
      </div>

      {error ? (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
          ยังไม่มีรายการตัดค่าเสื่อมราคา
        </p>
      ) : (
        <Table wrapperClassName="overflow-x-auto rounded-xl border border-slate-200">
          <TableHeader>
            <TableRow>
              <TableHead>งวดบัญชี</TableHead>
              <TableHead>วันที่ตัดค่าเสื่อม</TableHead>
              <TableHead className="text-right">ยอดตัดค่าเสื่อม</TableHead>
              <TableHead className="text-right">ค่าเสื่อมสะสม</TableHead>
              <TableHead className="text-right">มูลค่าตามบัญชี (NBV)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="whitespace-nowrap text-sm">
                  {formatPeriodCell(row.period_year, row.period_month)}
                </TableCell>
                <TableCell className="whitespace-nowrap font-mono text-sm tabular-nums">
                  {formatDdMmYyyy(row.depreciation_date)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {formatMoney(row.depreciation_amount)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm tabular-nums">
                  {formatMoney(row.accumulated_depreciation)}
                </TableCell>
                <TableCell className="text-right font-mono text-sm font-semibold tabular-nums">
                  {formatMoney(row.net_book_value)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export function AssetDetailSheet({
  asset,
  error,
  closeHref,
  depreciationLedger = [],
  depreciationLedgerError = null,
}: AssetDetailSheetProps) {
  const router = useRouter();
  const open = asset !== null || error !== null;

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) router.push(closeHref);
      }}
    >
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-2xl"
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-blue-600" />
            {asset?.asset_code ?? "รายละเอียดสินทรัพย์"}
          </SheetTitle>
          <SheetDescription>
            ทะเบียนสินทรัพย์ถาวร — อ่านอย่างเดียว
          </SheetDescription>
        </SheetHeader>

        {error ? (
          <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {asset ? (
          <div className="flex flex-col gap-6 px-6 pb-8 pt-4">
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field label="รหัสสินทรัพย์ (Asset Code)">
                <span className="font-mono">{asset.asset_code}</span>
              </Field>
              <Field label="สถานะ">
                <Badge
                  variant={
                    asset.status === "ACTIVE"
                      ? "emerald"
                      : asset.status === "UNDER_MAINTENANCE"
                        ? "amber"
                        : "slate"
                  }
                >
                  {FIXED_ASSET_STATUS_LABELS[asset.status]}
                </Badge>
              </Field>
              <Field label="ชื่อทรัพย์สิน">
                {asset.asset_name}
              </Field>
              <Field label="หมวดหมู่">
                {asset.category_name
                  ? `${asset.category_code ?? ""} · ${asset.category_name}`
                  : "—"}
              </Field>
              <Field label="วันที่ซื้อ (Acquisition Date)">
                {formatDocDate(asset.purchase_date)}
              </Field>
              <Field label="อายุใช้งาน (Useful Life)">
                {asset.useful_life_years != null
                  ? `${asset.useful_life_years} ปี (${asset.useful_life_months} เดือน)`
                  : "—"}
              </Field>
              <Field label="ราคาทุน (Acquisition Cost)">
                <span className="tabular-nums">
                  {formatThaiBaht(asset.acquisition_cost)}
                </span>
              </Field>
              <Field label="มูลค่าซาก (Salvage Value)">
                <span className="tabular-nums">
                  {formatThaiBaht(asset.salvage_value)}
                </span>
              </Field>
              <Field label="ค่าเสื่อมสะสม">
                <span className="tabular-nums">
                  {formatThaiBaht(asset.accumulated_depreciation)}
                </span>
              </Field>
              <Field label="มูลค่าตามบัญชี (Net Book Value)">
                <span className="tabular-nums font-semibold">
                  {formatThaiBaht(asset.net_book_value)}
                </span>
              </Field>
              <Field label="สถานที่ตั้ง">
                {asset.location?.trim() || "—"}
              </Field>
              <Field label="บิลค่าใช้จ่ายอ้างอิง (Link Expense)">
                {asset.expense_document_no ? (
                  asset.expense_id ? (
                    <Link
                      href={`/expenses/${asset.expense_id}`}
                      className="inline-flex items-center gap-1 font-mono text-blue-700 hover:underline"
                    >
                      {asset.expense_document_no}
                      <ExternalLink className="size-3.5" />
                    </Link>
                  ) : (
                    <span className="font-mono">{asset.expense_document_no}</span>
                  )
                ) : (
                  "—"
                )}
              </Field>
            </div>

            <DepreciationLedgerSection
              rows={depreciationLedger}
              error={depreciationLedgerError}
            />

            <div className="flex justify-end border-t border-slate-100 pt-4">
              <Link
                href={closeHref}
                className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              >
                ปิด
              </Link>
            </div>
          </div>
        ) : !error ? (
          <div className="px-6 pb-8 pt-4">
            <Link
              href={closeHref}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              ปิด
            </Link>
          </div>
        ) : (
          <div className="flex justify-end px-6 pb-8 pt-4">
            <Link
              href={closeHref}
              className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              ปิด
            </Link>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
