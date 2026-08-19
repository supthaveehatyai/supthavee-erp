"use client";

import { useRouter } from "next/navigation";
import { FileText, Package } from "lucide-react";
import type { AdjustmentDetail } from "@/types/inventory-adjustment";
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

type Props = {
  detail: AdjustmentDetail | null;
  error: string | null;
};

function formatDate(value: string): string {
  if (!value) return "—";
  return new Date(`${value}T00:00:00`).toLocaleDateString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatDateTime(value: string): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("th-TH", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AdjustmentDetailSheet({ detail, error }: Props) {
  const router = useRouter();
  const open = detail !== null || error !== null;

  const isOb = detail?.doc_type === "STK_OB";

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) router.push("/inventory/adjustments");
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            {detail?.doc_no ?? "รายละเอียดเอกสาร"}
          </SheetTitle>
          <SheetDescription>
            {isOb ? "ยอดยกมา (Opening Balance)" : "ปรับปรุงสต็อก (Stock Adjustment)"}
          </SheetDescription>
        </SheetHeader>

        {error ? (
          <div className="mx-6 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        ) : null}

        {detail ? (
          <div className="flex flex-col gap-6 px-6 pb-8 pt-4">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <span className="text-slate-500">เลขที่เอกสาร</span>
                <p className="font-mono font-semibold text-slate-900">
                  {detail.doc_no}
                </p>
              </div>
              <div>
                <span className="text-slate-500">ประเภท</span>
                <p>
                  <Badge
                    className={
                      isOb
                        ? "bg-indigo-50 text-indigo-800 ring-indigo-200"
                        : "bg-amber-50 text-amber-900 ring-amber-200"
                    }
                  >
                    {isOb ? "STK_OB · ยอดยกมา" : "STK_ADJ · ปรับปรุง"}
                  </Badge>
                </p>
              </div>
              <div>
                <span className="text-slate-500">วันที่เอกสาร</span>
                <p className="font-medium text-slate-900">
                  {formatDate(detail.doc_date)}
                </p>
              </div>
              <div>
                <span className="text-slate-500">สถานะ</span>
                <p>
                  <Badge variant="slate">{detail.status}</Badge>
                </p>
              </div>
              <div>
                <span className="text-slate-500">สร้างเมื่อ</span>
                <p className="text-slate-700">
                  {formatDateTime(detail.created_at)}
                </p>
              </div>
              {detail.remark ? (
                <div className="col-span-2">
                  <span className="text-slate-500">เหตุผล / หมายเหตุ</span>
                  <p className="text-slate-800">{detail.remark}</p>
                </div>
              ) : null}
            </div>

            {/* Line items */}
            <div>
              <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <Package className="h-4 w-4" />
                รายการสินค้า ({detail.items.length})
              </h3>
              <div className="overflow-hidden rounded-xl border border-slate-200">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50">
                      <TableHead className="w-10 text-center">#</TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>สินค้า</TableHead>
                      <TableHead>สี</TableHead>
                      <TableHead>ไซส์</TableHead>
                      <TableHead className="text-right">จำนวน</TableHead>
                      <TableHead className="text-right">ต้นทุน/หน่วย</TableHead>
                      <TableHead className="text-right">รวม</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detail.items.map((item, idx) => {
                      const isNeg = item.qty < 0;
                      return (
                        <TableRow key={item.id}>
                          <TableCell className="text-center text-xs text-slate-400">
                            {idx + 1}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {item.sku || "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {item.product_name}
                          </TableCell>
                          <TableCell className="text-sm">
                            {item.color || "—"}
                          </TableCell>
                          <TableCell className="text-sm">
                            {item.size || "—"}
                          </TableCell>
                          <TableCell
                            className={`text-right tabular-nums font-semibold ${isNeg ? "text-red-600" : "text-emerald-700"}`}
                          >
                            {isNeg ? `−${Math.abs(item.qty)}` : `+${item.qty}`}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {item.unit_cost_price.toLocaleString("th-TH", {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 4,
                            })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums text-sm">
                            {item.line_total.toLocaleString("th-TH", {
                              minimumFractionDigits: 2,
                            })}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
