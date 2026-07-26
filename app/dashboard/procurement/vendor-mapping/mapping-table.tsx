"use client";

import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { FlattenedVendorMapping } from "./types";

type MappingTableProps = {
  mappings: FlattenedVendorMapping[];
  isLoading: boolean;
  deletingId: string | null;
  onDelete: (mappingId: string) => void;
  vendorSelected: boolean;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function MappingTable({
  mappings,
  isLoading,
  deletingId,
  onDelete,
  vendorSelected,
}: MappingTableProps) {
  if (!vendorSelected) {
    return (
      <p className="px-1 py-10 text-center text-sm text-slate-400">
        เลือกผู้จำหน่ายด้านบนเพื่อดูรายการจับคู่
      </p>
    );
  }

  if (isLoading) {
    return (
      <p className="px-1 py-10 text-center text-sm text-slate-400">
        กำลังโหลดรายการจับคู่...
      </p>
    );
  }

  if (mappings.length === 0) {
    return (
      <p className="px-1 py-10 text-center text-sm text-slate-400">
        ยังไม่มีการจับคู่สำหรับ Vendor นี้
      </p>
    );
  }

  return (
    <Table className="min-w-[640px]">
      <TableHeader>
        <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
          <TableHead>รหัสโรงงาน</TableHead>
          <TableHead>ชื่อโรงงาน</TableHead>
          <TableHead>SKU ภายใน</TableHead>
          <TableHead>หน่วย</TableHead>
          <TableHead>วันที่</TableHead>
          <TableHead className="text-right">จัดการ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {mappings.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <span className="font-mono text-xs font-semibold text-slate-800">
                {row.vendor_sku}
              </span>
            </TableCell>
            <TableCell>{row.vendor_product_name || "—"}</TableCell>
            <TableCell>
              <p className="font-mono text-xs font-semibold text-blue-700">
                {row.product?.sku ?? "—"}
              </p>
              <p className="mt-0.5 text-[11px] text-slate-400">
                {row.product?.name ?? "สินค้าถูกลบแล้ว"}
                {[row.product?.color, row.product?.size].filter(Boolean)
                  .length > 0
                  ? ` · ${[row.product?.color, row.product?.size]
                      .filter(Boolean)
                      .join(" / ")}`
                  : ""}
              </p>
            </TableCell>
            <TableCell className="text-xs text-slate-500">
              {row.vendor_uom || "—"}
            </TableCell>
            <TableCell className="text-xs text-slate-400">
              {formatDate(row.created_at)}
            </TableCell>
            <TableCell className="text-right">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onDelete(row.id)}
                disabled={deletingId === row.id}
                className="text-red-600 hover:bg-red-50 hover:text-red-700"
              >
                {deletingId === row.id ? "กำลังลบ..." : "Delete"}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
