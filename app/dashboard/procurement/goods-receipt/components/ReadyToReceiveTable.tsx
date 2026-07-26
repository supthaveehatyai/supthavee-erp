"use client";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { MatchedOcrLine } from "../types";

type ReadyToReceiveTableProps = {
  rows: MatchedOcrLine[];
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ReadyToReceiveTable({ rows }: ReadyToReceiveTableProps) {
  if (rows.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-slate-400">
        ยังไม่มีรายการที่จับคู่ได้
      </p>
    );
  }

  return (
    <Table className="min-w-[820px]">
      <TableHeader>
        <TableRow className="bg-emerald-50/60 hover:bg-emerald-50/60">
          <TableHead>รหัส OCR</TableHead>
          <TableHead>SKU ภายใน</TableHead>
          <TableHead>สินค้า</TableHead>
          <TableHead className="text-right">จำนวน</TableHead>
          <TableHead className="text-right">ราคา/หน่วย</TableHead>
          <TableHead className="text-right">รวม</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const lineTotal = row.ocr.qty * row.ocr.unit_price;
          return (
            <TableRow key={row.lineKey}>
              <TableCell>
                <p className="font-mono text-xs font-semibold text-slate-800">
                  {row.normalizedSku}
                </p>
                <p className="mt-0.5 max-w-[180px] truncate text-[11px] text-slate-400">
                  {row.ocr.raw_description || "—"}
                </p>
              </TableCell>
              <TableCell>
                <span className="font-mono text-xs font-semibold text-blue-700">
                  {row.product.sku}
                </span>
              </TableCell>
              <TableCell>
                <p className="text-sm text-slate-700">{row.product.name}</p>
                <p className="text-[11px] text-slate-400">
                  {[row.product.color, row.product.size]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {row.ocr.qty.toLocaleString("th-TH")}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatMoney(row.ocr.unit_price)}
              </TableCell>
              <TableCell className="text-right font-semibold tabular-nums text-slate-800">
                {formatMoney(lineTotal)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
