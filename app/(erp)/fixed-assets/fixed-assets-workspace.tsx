"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Building2, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { disposeFixedAsset } from "@/app/actions/fixed-assets";
import { FixedAssetFilter } from "@/app/(erp)/fixed-assets/fixed-asset-filter";
import { FixedAssetFormSheet } from "@/app/(erp)/fixed-assets/fixed-asset-form-sheet";
import type {
  AssetCategory,
  FixedAssetListItem,
  FixedAssetStatus,
  LinkableExpenseOption,
} from "@/types/fixed-assets";
import { FIXED_ASSET_STATUS_LABELS } from "@/types/fixed-assets";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export type FixedAssetsWorkspaceProps = {
  rows: FixedAssetListItem[];
  error: string | null;
  categories: AssetCategory[];
  categoriesError: string | null;
  expenses: LinkableExpenseOption[];
  expensesError: string | null;
  query: string;
  status: FixedAssetStatus | "ALL";
  createOpen: boolean;
  editAsset: FixedAssetListItem | null;
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

function StatusBadge({ status }: { status: FixedAssetStatus }) {
  if (status === "ACTIVE") {
    return <Badge variant="emerald">{FIXED_ASSET_STATUS_LABELS.ACTIVE}</Badge>;
  }
  if (status === "UNDER_MAINTENANCE") {
    return (
      <Badge className="border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-50">
        {FIXED_ASSET_STATUS_LABELS.UNDER_MAINTENANCE}
      </Badge>
    );
  }
  return (
    <Badge className="border-red-200 bg-red-50 text-red-700 hover:bg-red-50">
      {FIXED_ASSET_STATUS_LABELS.DISPOSED}
    </Badge>
  );
}

export function FixedAssetsWorkspace({
  rows,
  error,
  categories,
  categoriesError,
  expenses,
  expensesError,
  query,
  status,
  createOpen,
  editAsset,
}: FixedAssetsWorkspaceProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pendingDispose, setPendingDispose] =
    useState<FixedAssetListItem | null>(null);
  const [isDisposing, startDisposeTransition] = useTransition();

  const sheetOpen = createOpen || Boolean(editAsset);
  const sheetMode = editAsset ? "edit" : "create";

  function buildHref(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(updates)) {
      if (value == null || value === "") params.delete(key);
      else params.set(key, value);
    }
    const qs = params.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  }

  function handleConfirmDispose() {
    if (!pendingDispose || isDisposing) return;
    const target = pendingDispose;

    startDisposeTransition(async () => {
      const result = await disposeFixedAsset(target.id);
      if (!result.success) {
        toast.error(result.error ?? "ไม่สามารถจำหน่ายสินทรัพย์ได้");
        return;
      }
      toast.success(`จำหน่ายสินทรัพย์ ${target.asset_code} แล้ว`);
      setPendingDispose(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
              <Building2 className="h-8 w-8 text-blue-600" />
              สินทรัพย์ถาวร (Fixed Assets)
            </h1>
            <p className="text-slate-500">
              ทะเบียนสินทรัพย์ถาวร — Phase 14 · ราคาทุน + อายุใช้งาน
              (เตรียม Straight-line Depreciation)
            </p>
          </div>

          <Link
            href={buildHref({ create: "1", edit_id: null })}
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <Plus className="h-4 w-4" />
            ลงทะเบียนสินทรัพย์
          </Link>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {categoriesError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {categoriesError}
          </div>
        ) : null}

        {expensesError ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            {expensesError}
          </div>
        ) : null}

        <FixedAssetFilter query={query} status={status} />

        <Card>
          <CardHeader>
            <CardTitle>รายการสินทรัพย์ถาวร</CardTitle>
            <CardDescription>
              ค้นหาและกรองสถานะผ่าน URL Search Parameters · ห้าม Hard Delete
              (ใช้จำหน่าย / Soft Dispose)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-500">
                ยังไม่มีสินทรัพย์ในทะเบียน — กด &quot;ลงทะเบียนสินทรัพย์&quot; เพื่อเริ่มต้น
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>รหัส</TableHead>
                      <TableHead>ชื่อทรัพย์สิน</TableHead>
                      <TableHead>หมวดหมู่</TableHead>
                      <TableHead>สถานที่ตั้ง</TableHead>
                      <TableHead>วันที่ซื้อ</TableHead>
                      <TableHead className="text-right">ราคาทุน</TableHead>
                      <TableHead className="text-center">อายุ (ปี)</TableHead>
                      <TableHead>สถานะ</TableHead>
                      <TableHead className="text-right">จัดการ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow
                        key={row.id}
                        className={
                          row.status === "DISPOSED"
                            ? "bg-slate-50/60 opacity-70"
                            : undefined
                        }
                      >
                        <TableCell className="font-mono text-sm font-semibold text-slate-900">
                          {row.asset_code}
                        </TableCell>
                        <TableCell className="font-medium text-slate-900">
                          {row.asset_name}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {row.category_name
                            ? `${row.category_code ?? ""} · ${row.category_name}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">
                          {row.location || "—"}
                        </TableCell>
                        <TableCell>{formatDocDate(row.purchase_date)}</TableCell>
                        <TableCell className="text-right tabular-nums font-medium">
                          {formatThaiBaht(row.acquisition_cost)}
                        </TableCell>
                        <TableCell className="text-center tabular-nums">
                          {row.useful_life_years ?? "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center gap-1.5">
                            <Link
                              href={buildHref({
                                edit_id: row.id,
                                create: null,
                              })}
                              className="inline-flex h-8 items-center justify-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 transition hover:bg-slate-50"
                            >
                              <Pencil className="size-3.5" />
                              แก้ไข
                            </Link>
                            {row.status !== "DISPOSED" ? (
                              <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                className="h-8 gap-1"
                                disabled={isDisposing}
                                onClick={() => setPendingDispose(row)}
                              >
                                <Trash2 className="size-3.5" />
                                จำหน่าย
                              </Button>
                            ) : null}
                          </div>
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

      <FixedAssetFormSheet
        open={sheetOpen}
        mode={sheetMode}
        categories={categories}
        expenses={expenses}
        initialAsset={editAsset}
      />

      <AlertDialog
        open={Boolean(pendingDispose)}
        onOpenChange={(next) => {
          if (!isDisposing && !next) setPendingDispose(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>ยืนยันจำหน่ายสินทรัพย์</AlertDialogTitle>
            <AlertDialogDescription>
              ระบบจะเปลี่ยนสถานะเป็น &quot;จำหน่ายแล้ว&quot; โดยไม่ลบประวัติ
              (Soft Dispose ตามมาตรฐาน ERP)
              {pendingDispose ? (
                <span className="mt-2 block font-medium text-slate-700">
                  {pendingDispose.asset_code} · {pendingDispose.asset_name}
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDisposing} />
            <AlertDialogAction
              disabled={isDisposing}
              className="bg-red-600 hover:bg-red-700 disabled:bg-red-400"
              onClick={(event) => {
                event.preventDefault();
                handleConfirmDispose();
              }}
            >
              {isDisposing ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  กำลังจำหน่าย...
                </>
              ) : (
                "ยืนยันจำหน่าย"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
