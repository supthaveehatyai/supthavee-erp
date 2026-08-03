"use client";

/**
 * Enterprise Ledger Slide-over — opens when `productId` is in the URL.
 * Data is fetched on the Server and passed in (Zero Client-Side Fetching).
 * Closing removes `productId` from URL search params (keeps q / dates).
 */

import { useRouter } from "next/navigation";
import { Package } from "lucide-react";
import type {
  ProductStockCardData,
  StockCardMovement,
} from "@/lib/actions/inventory";
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
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";

function formatQty(value: number): string {
  return value.toLocaleString("th-TH");
}

function formatTxnDate(value: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return new Intl.DateTimeFormat("th-TH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(date);
}

function typeBadgeClass(type: string): string {
  const t = type.toUpperCase();
  if (t === "IN") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (t === "OUT") return "bg-red-50 text-red-700 ring-red-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

function qtyInOut(row: StockCardMovement): {
  qtyIn: number | null;
  qtyOut: number | null;
} {
  const t = String(row.transaction_type).toUpperCase();
  if (t === "IN") return { qtyIn: row.quantity, qtyOut: null };
  if (t === "OUT") return { qtyIn: null, qtyOut: row.quantity };
  if (row.signed_qty > 0) return { qtyIn: Math.abs(row.signed_qty), qtyOut: null };
  if (row.signed_qty < 0) return { qtyIn: null, qtyOut: Math.abs(row.signed_qty) };
  return { qtyIn: null, qtyOut: null };
}

function buildUrlWithoutProductId(args: {
  q?: string;
  startDate?: string;
  endDate?: string;
}): string {
  const params = new URLSearchParams();
  if (args.q?.trim()) params.set("q", args.q.trim());
  if (args.startDate?.trim()) params.set("startDate", args.startDate.trim());
  if (args.endDate?.trim()) params.set("endDate", args.endDate.trim());
  const qs = params.toString();
  return qs ? `/inventory/ledger?${qs}` : "/inventory/ledger";
}

export type LedgerSheetProps = {
  /** Open when productId is present in URL */
  open: boolean;
  data?: ProductStockCardData | null;
  error?: string | null;
  q?: string;
  startDate?: string;
  endDate?: string;
};

export function LedgerSheet({
  open,
  data = null,
  error = null,
  q = "",
  startDate = "",
  endDate = "",
}: LedgerSheetProps) {
  const router = useRouter();

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) return;
    router.push(
      buildUrlWithoutProductId({ q, startDate, endDate }),
      { scroll: false },
    );
  }

  const product = data?.product ?? null;

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 p-0 sm:max-w-3xl"
      >
        <SheetHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-mono text-sm tracking-tight">
                {product?.sku ?? "บัตรสต็อก (Stock Card)"}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-sm font-medium text-slate-700">
                {product?.model || product?.name || "ความเคลื่อนไหวสินค้าคงคลัง"}
              </SheetDescription>
              {product ? (
                <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    สี: {product.color || "—"}
                  </span>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                    ไซส์: {product.size || "—"}
                  </span>
                  {product.name && product.model ? (
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 font-medium text-slate-700">
                      ชื่อ: {product.name}
                    </span>
                  ) : null}
                </div>
              ) : null}
            </div>
            {data ? (
              <div className="shrink-0 text-right">
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  คงเหลือปลายงวด
                </p>
                <p className="text-xl font-bold tabular-nums text-slate-900">
                  {formatQty(data.closing_balance)}
                </p>
              </div>
            ) : null}
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          ) : null}

          {!error && !data ? (
            <div className="py-12 text-center text-sm text-slate-500">
              ไม่พบข้อมูล Ledger
            </div>
          ) : null}

          {data ? (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow className="bg-slate-50/90 hover:bg-slate-50/90">
                    <TableHead className="h-9 w-[7rem] px-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      วันที่
                    </TableHead>
                    <TableHead className="h-9 px-3 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      เลขที่เอกสาร
                    </TableHead>
                    <TableHead className="h-9 w-[5.5rem] px-3 text-center text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      ประเภท
                    </TableHead>
                    <TableHead className="h-9 w-[5.5rem] px-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      รับ
                    </TableHead>
                    <TableHead className="h-9 w-[5.5rem] px-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      จ่าย
                    </TableHead>
                    <TableHead className="h-9 w-[6.5rem] px-3 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                      คงเหลือ
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow className="bg-slate-50/50">
                    <TableCell className="px-3 py-2.5 text-slate-400">—</TableCell>
                    <TableCell className="px-3 py-2.5 text-xs font-semibold text-slate-800">
                      ยอดยกมา (Brought Forward)
                    </TableCell>
                    <TableCell />
                    <TableCell />
                    <TableCell />
                    <TableCell className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-slate-900">
                      {formatQty(data.brought_forward)}
                    </TableCell>
                  </TableRow>

                  {data.movements.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-10 text-center text-sm text-slate-500"
                      >
                        ไม่มีความเคลื่อนไหวในช่วงวันที่ที่เลือก
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.movements.map((row) => {
                      const { qtyIn, qtyOut } = qtyInOut(row);
                      const type = String(row.transaction_type).toUpperCase();
                      return (
                        <TableRow key={row.id} className="text-xs">
                          <TableCell className="px-3 py-2.5 whitespace-nowrap tabular-nums text-slate-700">
                            {formatTxnDate(row.transaction_date)}
                          </TableCell>
                          <TableCell className="px-3 py-2.5 font-mono text-[11px] font-medium text-slate-800">
                            {row.document_no || "—"}
                          </TableCell>
                          <TableCell className="px-3 py-2.5 text-center">
                            <span
                              className={cn(
                                "inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset",
                                typeBadgeClass(type),
                              )}
                            >
                              {type}
                            </span>
                          </TableCell>
                          <TableCell
                            className={cn(
                              "px-3 py-2.5 text-right tabular-nums",
                              qtyIn != null
                                ? "font-semibold text-emerald-600"
                                : "text-slate-300",
                            )}
                          >
                            {qtyIn != null ? formatQty(qtyIn) : "—"}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "px-3 py-2.5 text-right tabular-nums",
                              qtyOut != null
                                ? "font-semibold text-red-600"
                                : "text-slate-300",
                            )}
                          >
                            {qtyOut != null ? formatQty(qtyOut) : "—"}
                          </TableCell>
                          <TableCell className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">
                            {formatQty(row.running_balance)}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
                <TableFooter>
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="px-3 py-2.5 text-right text-xs font-semibold"
                    >
                      ยอดคงเหลือปลายงวด
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right text-sm font-bold tabular-nums">
                      {formatQty(data.closing_balance)}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
