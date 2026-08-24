"use client";

/**
 * Fixed Asset Detail — URL-driven slide-over (`?view_asset_id=`).
 * Data is fetched on the Server and passed in (Zero Client-Side Fetching).
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { Building2, ExternalLink } from "lucide-react";
import type { FixedAssetListItem } from "@/types/fixed-assets";
import { FIXED_ASSET_STATUS_LABELS } from "@/types/fixed-assets";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

export type AssetDetailSheetProps = {
  asset: FixedAssetListItem | null;
  error: string | null;
  /** URL without `view_asset_id` — preserves filters and other params */
  closeHref: string;
};

function formatThaiBaht(value: number): string {
  return new Intl.NumberFormat("th-TH", {
    style: "currency",
    currency: "THB",
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

export function AssetDetailSheet({
  asset,
  error,
  closeHref,
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
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
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
            <Button asChild variant="outline">
              <Link href={closeHref}>ปิด</Link>
            </Button>
          </div>
        ) : (
          <div className="flex justify-end px-6 pb-8 pt-4">
            <Button asChild variant="outline">
              <Link href={closeHref}>ปิด</Link>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
