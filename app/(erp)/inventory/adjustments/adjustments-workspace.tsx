"use client";

import Link from "next/link";
import { PackagePlus, Scale } from "lucide-react";
import type { InventoryAdjustmentListItem } from "@/types/inventory-adjustment";
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
import { AdjustmentFormDialog } from "@/components/inventory/adjustment-form-dialog";
import type { InventoryDocType } from "@/lib/constants/document";

export type AdjustmentsWorkspaceProps = {
  rows: InventoryAdjustmentListItem[];
  error: string | null;
  createMode: InventoryDocType | null;
};

function formatDate(value: string): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function docTypeBadge(docType: string) {
  if (docType === "STK_OB") {
    return (
      <Badge className="bg-indigo-50 text-indigo-800 ring-indigo-200 hover:bg-indigo-50">
        STK_OB · ยอดยกมา
      </Badge>
    );
  }
  return (
    <Badge className="bg-amber-50 text-amber-900 ring-amber-200 hover:bg-amber-50">
      STK_ADJ · ปรับปรุง
    </Badge>
  );
}

export function AdjustmentsWorkspace({
  rows,
  error,
  createMode,
}: AdjustmentsWorkspaceProps) {
  return (
    <>
      <div className="flex flex-col gap-6 p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex flex-col gap-2">
            <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">
              <Scale className="h-8 w-8 text-blue-600" />
              ปรับปรุงคลังสินค้า
            </h1>
            <p className="text-sm text-slate-500">
              Phase 14 — Ledger-Driven (STK_OB / STK_ADJ) · รันเลข SOB / SAD
              ตอน Issue
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/inventory/adjustments?create=STK_OB"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-white px-4 text-sm font-semibold text-indigo-800 shadow-sm transition hover:bg-indigo-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 focus-visible:ring-offset-2"
            >
              <PackagePlus className="h-4 w-4" />
              ยอดยกมา (STK_OB)
            </Link>
            <Link
              href="/inventory/adjustments?create=STK_ADJ"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
            >
              <Scale className="h-4 w-4" />
              ปรับปรุงสต็อก (STK_ADJ)
            </Link>
          </div>
        </div>

        {error ? (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>ประวัติการปรับปรุง</CardTitle>
            <CardDescription>
              เอกสาร STK_OB / STK_ADJ ที่ออกแล้ว (ISSUED / COMPLETED)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {rows.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center text-sm text-slate-500">
                ยังไม่มีเอกสารปรับปรุงสต็อก — กดปุ่มด้านบนเพื่อเริ่มต้น
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead>เลขที่</TableHead>
                      <TableHead>ประเภท</TableHead>
                      <TableHead>วันที่</TableHead>
                      <TableHead>เหตุผล</TableHead>
                      <TableHead className="text-center">บรรทัด</TableHead>
                      <TableHead className="text-right text-emerald-700">
                        เข้า (IN)
                      </TableHead>
                      <TableHead className="text-right text-red-600">
                        ออก (OUT)
                      </TableHead>
                      <TableHead>สถานะ</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell className="font-mono text-sm font-semibold text-slate-900">
                          {row.doc_no}
                        </TableCell>
                        <TableCell>{docTypeBadge(row.doc_type)}</TableCell>
                        <TableCell>{formatDate(row.doc_date)}</TableCell>
                        <TableCell className="max-w-[240px] truncate text-sm text-slate-600">
                          {row.remark || "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          {row.line_count}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-emerald-700">
                          {row.total_in_qty > 0
                            ? `+${row.total_in_qty.toLocaleString("th-TH")}`
                            : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-red-600">
                          {row.total_out_qty > 0
                            ? `−${row.total_out_qty.toLocaleString("th-TH")}`
                            : "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant="slate">{row.status}</Badge>
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

      <AdjustmentFormDialog
        open={createMode === "STK_OB" || createMode === "STK_ADJ"}
        docType={createMode}
      />
    </>
  );
}
