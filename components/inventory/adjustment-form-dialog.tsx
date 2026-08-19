"use client";

/**
 * URL-Driven Modal — สร้าง STK_OB / STK_ADJ (?create=STK_OB | STK_ADJ)
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { adjustInventory } from "@/lib/actions/inventory-adjustment";
import { cn } from "@/lib/utils";
import type { InventoryDocType } from "@/lib/constants/document";
import type { AdjustmentFormLine } from "@/types/inventory-adjustment";
import { AdjustmentMatrixPicker } from "@/components/inventory/adjustment-matrix-picker";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";

export type AdjustmentFormDialogProps = {
  open: boolean;
  docType: InventoryDocType | null;
};

function todayIsoLocal(): string {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function docTypeLabel(docType: InventoryDocType): string {
  return docType === "STK_OB"
    ? "ยอดยกมา (STK_OB)"
    : "ปรับปรุงสต็อก (STK_ADJ)";
}

export function AdjustmentFormDialog({
  open,
  docType,
}: AdjustmentFormDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [docDate, setDocDate] = useState(todayIsoLocal);
  const [remark, setRemark] = useState("");
  const [lines, setLines] = useState<AdjustmentFormLine[]>([]);

  useEffect(() => {
    if (open && docType) {
      setDocDate(todayIsoLocal());
      setRemark("");
      setLines([]);
    }
  }, [open, docType]);

  const isAdj = docType === "STK_ADJ";
  const isOb = docType === "STK_OB";

  function closeDialog() {
    router.push("/inventory/adjustments", { scroll: false });
  }

  function mergeLines(incoming: AdjustmentFormLine[]) {
    setLines((current) => {
      const map = new Map(current.map((line) => [line.product_id, line]));
      for (const row of incoming) {
        map.set(row.product_id, row);
      }
      return [...map.values()];
    });
  }

  function removeLine(productId: string) {
    setLines((current) =>
      current.filter((line) => line.product_id !== productId),
    );
  }

  function updateLine(
    productId: string,
    field: "qty" | "unit_cost_price",
    value: string,
  ) {
    setLines((current) =>
      current.map((line) =>
        line.product_id === productId ? { ...line, [field]: value } : line,
      ),
    );
  }

  const canSubmit = useMemo(() => {
    if (!docType || lines.length === 0) return false;
    if (isAdj && !remark.trim()) return false;
    return lines.some((line) => {
      const qty = Number.parseFloat(line.qty);
      if (!Number.isFinite(qty) || qty === 0) return false;
      if (isOb && qty <= 0) return false;
      if (isOb) {
        const cost = Number.parseFloat(line.unit_cost_price);
        return Number.isFinite(cost) && cost >= 0;
      }
      return true;
    });
  }, [docType, lines, remark, isAdj, isOb]);

  function handleSubmit() {
    if (!docType) return;

    startTransition(async () => {
      const payload = {
        doc_type: docType,
        doc_date: docDate,
        remark: remark.trim() || undefined,
        lines: lines
          .map((line) => ({
            product_id: line.product_id,
            qty: Number.parseFloat(line.qty),
            unit_cost_price: line.unit_cost_price.trim()
              ? Number.parseFloat(line.unit_cost_price)
              : undefined,
          }))
          .filter((line) => Number.isFinite(line.qty) && line.qty !== 0),
      };

      const result = await adjustInventory(payload);
      if (!result.success) {
        toast.error(result.error ?? "บันทึกไม่สำเร็จ");
        return;
      }

      toast.success(`บันทึกสำเร็จ — ${result.doc_no}`);
      closeDialog();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open && Boolean(docType)}
      onOpenChange={(next) => {
        if (!next && !isPending) closeDialog();
      }}
    >
      <DialogContent className="flex max-h-[92vh] max-w-4xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-slate-100 px-6 pt-6 pb-4">
          <DialogTitle>
            {docType ? docTypeLabel(docType) : "ปรับปรุงคลังสินค้า"}
          </DialogTitle>
          <DialogDescription>
            Ledger-Driven — บันทึกผ่าน inventory_ledger เท่านั้น (ไม่แก้
            products โดยตรง)
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          {/* ── Document Header ── */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="adj_doc_date">วันที่เอกสาร</Label>
              <Input
                id="adj_doc_date"
                type="date"
                value={docDate}
                disabled={isPending}
                onChange={(e) => setDocDate(e.target.value)}
              />
            </div>
            <div className="space-y-2 sm:col-span-1">
              <Label>
                เหตุผล / หมายเหตุ
                {isAdj ? (
                  <span className="ml-1 text-red-600">*</span>
                ) : null}
              </Label>
              <Textarea
                value={remark}
                disabled={isPending}
                placeholder={
                  isAdj
                    ? "ระบุเหตุผลการปรับปรุง (บังคับ) เช่น นับสต็อกพบส่วนต่าง"
                    : "หมายเหตุยอดยกมา (ถ้ามี)"
                }
                rows={2}
                onChange={(e) => setRemark(e.target.value)}
              />
            </div>
          </div>

          {/* ── Smart Matrix Selection (inline, not Popover) ── */}
          {docType ? (
            <AdjustmentMatrixPicker
              docType={docType}
              disabled={isPending}
              onAddLines={mergeLines}
            />
          ) : null}

          {/* ── Selected Line Items Review ── */}
          {lines.length > 0 ? (
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-semibold text-slate-800">
                รายการที่จะบันทึก ({lines.length})
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>สินค้า</TableHead>
                    <TableHead className="text-right">สต็อกปัจจุบัน</TableHead>
                    {isAdj ? (
                      <TableHead className="w-28 text-right text-blue-700">
                        นับได้จริง
                      </TableHead>
                    ) : null}
                    <TableHead className="w-28">
                      {isOb ? "ยอดยกมา" : "ส่วนต่าง"}
                    </TableHead>
                    {isOb ? (
                      <TableHead className="w-32">ต้นทุน/หน่วย</TableHead>
                    ) : null}
                    <TableHead className="w-12" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lines.map((line) => {
                    const qtyNum = Number.parseFloat(line.qty);
                    const isNegative =
                      Number.isFinite(qtyNum) && qtyNum < 0;
                    return (
                      <TableRow key={line.product_id}>
                        <TableCell>
                          <p className="font-mono text-xs text-slate-500">
                            {line.sku}
                          </p>
                          <p className="text-sm text-slate-800">
                            {line.display_name}
                          </p>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {line.stock_balance.toLocaleString("th-TH")}
                        </TableCell>
                        {isAdj ? (() => {
                          const varianceNum = Number.parseFloat(line.qty);
                          const countedQty = Number.isFinite(varianceNum)
                            ? line.stock_balance + varianceNum
                            : null;
                          return (
                            <TableCell className="text-right tabular-nums text-blue-700 font-medium">
                              {countedQty !== null ? countedQty.toLocaleString("th-TH") : "—"}
                            </TableCell>
                          );
                        })() : null}
                        <TableCell>
                          {isAdj ? (
                            <div
                              className={cn(
                                "h-9 flex items-center justify-end px-3 rounded-md border bg-slate-50 tabular-nums text-sm font-semibold",
                                isNegative
                                  ? "border-red-200 text-red-600"
                                  : qtyNum > 0
                                    ? "border-emerald-200 text-emerald-600"
                                    : "border-slate-200 text-slate-400",
                              )}
                            >
                              {isNegative ? `${qtyNum}` : qtyNum > 0 ? `+${qtyNum}` : "0"}
                            </div>
                          ) : (
                            <Input
                              type="number"
                              step="any"
                              min={0}
                              value={line.qty}
                              disabled={isPending}
                              onChange={(e) =>
                                updateLine(
                                  line.product_id,
                                  "qty",
                                  e.target.value,
                                )
                              }
                              className="h-9 text-right tabular-nums"
                            />
                          )}
                        </TableCell>
                        {isOb ? (
                          <TableCell>
                            <Input
                              type="number"
                              step="0.0001"
                              min={0}
                              value={line.unit_cost_price}
                              disabled={isPending}
                              onChange={(e) =>
                                updateLine(
                                  line.product_id,
                                  "unit_cost_price",
                                  e.target.value,
                                )
                              }
                              className="h-9 text-right tabular-nums"
                            />
                          </TableCell>
                        ) : null}
                        <TableCell>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            disabled={isPending}
                            onClick={() => removeLine(line.product_id)}
                            aria-label="ลบรายการ"
                          >
                            <Trash2 className="size-4 text-red-500" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 py-8 text-center text-sm text-slate-500">
              ใช้ Smart Matrix Selection ด้านบนเพื่อเพิ่ม SKU หลายไซส์พร้อมกัน
            </div>
          )}
        </div>

        <DialogFooter className="shrink-0 border-t border-slate-100 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={closeDialog}
          >
            ยกเลิก
          </Button>
          <Button
            type="button"
            disabled={!canSubmit || isPending}
            className="gap-2 bg-blue-600 hover:bg-blue-700"
            onClick={handleSubmit}
          >
            {isPending ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                กำลังบันทึก...
              </>
            ) : (
              "ยืนยันและออกเอกสาร (Issue)"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
