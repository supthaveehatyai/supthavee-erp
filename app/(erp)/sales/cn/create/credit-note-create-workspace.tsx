"use client";

/**
 * Credit Note create workspace — Client island.
 * Persistence via createCreditNoteAction only. Never touches Supabase client.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { createCreditNoteAction } from "@/lib/actions/credit-note-actions";
import { DOCUMENT_ACTIONS } from "@/lib/constants/document-actions";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { calculateDocumentSummary } from "@/lib/utils/document-summary";
import { qtyExceedsLimit } from "@/lib/utils/credit-note-line";
import type { CreditNoteSourceDocument } from "@/types/credit-note";
import { LineItemProductThumb } from "@/components/sales/LineItemProductThumb";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export type CreditNoteCreateWorkspaceProps = {
  source: CreditNoteSourceDocument;
};

type LineDraft = {
  source_item_id: string;
  qty: string;
  unit_price: string;
  return_to_inventory: boolean;
};

function formatMoney(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatQty(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const asText = String(value);
  if (!asText.includes(".")) return asText;
  return asText.replace(/\.?0+$/, "");
}

function parseQtyInput(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return parsed;
}

function formatUnitPrice(value: number): string {
  if (!Number.isFinite(value) || value < 0) return "0";
  return (Math.round(value * 100) / 100).toFixed(2);
}

function parseUnitPriceInput(raw: string): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function CreditNoteCreateWorkspace({
  source,
}: CreditNoteCreateWorkspaceProps) {
  const router = useRouter();
  const [docDate, setDocDate] = useState(todayIsoDate);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>(() =>
    source.items.map((item) => ({
      source_item_id: item.source_item_id,
      qty: item.remaining_qty > 0 ? formatQty(item.remaining_qty) : "0",
      unit_price: formatUnitPrice(item.unit_price),
      return_to_inventory: !item.is_service,
    })),
  );

  const itemById = useMemo(
    () => new Map(source.items.map((item) => [item.source_item_id, item])),
    [source.items],
  );

  const lineTotals = useMemo(() => {
    return lines.map((line) => {
      const origin = itemById.get(line.source_item_id);
      if (!origin) return 0;
      const qty = parseQtyInput(line.qty);
      const unitPrice = line.return_to_inventory
        ? origin.unit_price
        : parseUnitPriceInput(line.unit_price);
      if (qty <= 0 || origin.source_qty <= 0) return 0;
      const discount =
        origin.discount_amount > 0
          ? origin.discount_amount * (qty / origin.source_qty)
          : 0;
      return Math.round(Math.max(0, qty * unitPrice - discount) * 100) / 100;
    });
  }, [lines, itemById]);

  const billSummary = useMemo(() => {
    const cnLineSum = lineTotals.reduce((sum, value) => sum + value, 0);
    let discountText = source.discount_text;
    if (discountText && !discountText.includes("%") && source.total_amount > 0) {
      const prorated =
        Math.round(
          (source.discount_amount * (cnLineSum / source.total_amount)) * 100,
        ) / 100;
      discountText = prorated > 0 ? String(prorated) : null;
    }
    return calculateDocumentSummary({
      lineTotals,
      discountText,
      vatType: source.vat_type,
      vatRate: source.vat_rate,
    });
  }, [lineTotals, source]);

  const hasPositiveQty = lineTotals.some((value) => value > 0);
  const exceedsGrand = qtyExceedsLimit(
    billSummary.grand_total,
    source.remaining_grand_total,
  );

  function updateLine(sourceItemId: string, patch: Partial<LineDraft>) {
    setLines((current) =>
      current.map((line) => {
        if (line.source_item_id !== sourceItemId) return line;
        const origin = itemById.get(sourceItemId);
        const next: LineDraft = { ...line, ...patch };
        if (origin?.is_service) {
          next.return_to_inventory = false;
        }
        if (next.return_to_inventory && origin) {
          next.unit_price = formatUnitPrice(origin.unit_price);
        }
        return next;
      }),
    );
  }

  async function handleSubmit() {
    if (isSubmitting) return;
    if (!hasPositiveQty) {
      toast.error("กรุณาระบุจำนวนลดหนี้อย่างน้อย 1 รายการ");
      return;
    }
    if (exceedsGrand) {
      toast.error("ยอดใบลดหนี้เกินยอดคงเหลือของบิลต้นทาง");
      return;
    }

    const items = lines
      .map((line) => {
        const origin = itemById.get(line.source_item_id);
        const returnToInventory = origin?.is_service
          ? false
          : Boolean(line.return_to_inventory);
        return {
          source_item_id: line.source_item_id,
          qty: parseQtyInput(line.qty),
          unit_price: returnToInventory
            ? origin?.unit_price ?? parseUnitPriceInput(line.unit_price)
            : parseUnitPriceInput(line.unit_price),
          return_to_inventory: returnToInventory,
        };
      })
      .filter((line) => line.qty > 0);

    setIsSubmitting(true);
    try {
      const result = await createCreditNoteAction({
        ref_document_id: source.id,
        doc_date: docDate,
        notes,
        items,
      });
      if (result.error || !result.data) {
        toast.error(result.error ?? "บันทึกใบลดหนี้ไม่สำเร็จ");
        return;
      }
      toast.success(`บันทึกร่างใบลดหนี้ ${result.data.document_no} แล้ว`);
      router.push(`/sales/${encodeURIComponent(result.data.document_no)}`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "บันทึกใบลดหนี้ไม่สำเร็จ",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid size-11 place-items-center rounded-xl bg-rose-50 text-rose-700">
            <Undo2 className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-900">
              สร้างใบลดหนี้ (Credit Note)
            </h1>
            <p className="mt-0.5 text-sm text-slate-500">
              DRAFT ใช้เลขชั่วคราว Late Numbering · ผูกบิลต้นทางเสมอ
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/sales/${encodeURIComponent(source.doc_no)}`}
            className="inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-600 transition hover:bg-slate-50"
          >
            <ArrowLeft className="size-4" />
            กลับบิลต้นทาง
          </Link>
          <Button
            type="button"
            className="h-10 gap-2"
            disabled={isSubmitting || !hasPositiveQty || exceedsGrand}
            onClick={() => void handleSubmit()}
          >
            {isSubmitting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : null}
            {isSubmitting ? "กำลังบันทึก..." : DOCUMENT_ACTIONS.SAVE_DRAFT}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">บิลขายต้นทาง</CardTitle>
            <CardDescription>ห้ามออกใบลดหนี้โดยไม่มีเอกสารอ้างอิง</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-mono text-base font-semibold text-slate-900">
              {source.doc_no}
            </p>
            <p className="text-slate-600">
              {source.doc_type} · สถานะ {source.status} · วันที่{" "}
              {formatThaiDate(source.doc_date, "long")}
            </p>
            <p className="text-slate-600">ลูกค้า: {source.customer_name}</p>
            <p className="text-slate-500">
              ยอดบิลต้นทาง {formatMoney(source.grand_total)} บาท · คงเหลือลดหนี้ได้{" "}
              {formatMoney(source.remaining_grand_total)} บาท
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">หัวเอกสารใบลดหนี้</CardTitle>
            <CardDescription>
              VAT สืบทอดจากบิลต้นทาง ({source.vat_type} {source.vat_rate}%)
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="cn-doc-date">วันที่เอกสาร</Label>
              <Input
                id="cn-doc-date"
                type="date"
                value={docDate}
                disabled={isSubmitting}
                onChange={(event) => setDocDate(event.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="cn-notes">หมายเหตุ / เหตุผลการลดหนี้</Label>
              <Textarea
                id="cn-notes"
                value={notes}
                disabled={isSubmitting}
                placeholder="เช่น สินค้าชำรุด, คืนของ, ปรับราคา"
                onChange={(event) => setNotes(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">รายการลดหนี้</CardTitle>
          <CardDescription>
            รับคืนสต็อกจะล็อคราคาขายเดิมจากบิลต้นทาง ·
            ปิดสวิตช์รับคืนจึงแก้ราคา/หน่วยได้กรณีชดเชยราคา (Price Adjustment)
          </CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-50">
                <TableHead>สินค้า</TableHead>
                <TableHead className="text-right">ต้นทาง</TableHead>
                <TableHead className="text-right">คงเหลือ</TableHead>
                <TableHead className="w-32 text-right">จำนวนลดหนี้</TableHead>
                <TableHead className="w-36 text-right">
                  <span className="block">ราคา/หน่วย</span>
                  <span className="mt-0.5 block text-[11px] font-normal text-slate-400">
                    (ยอดที่ต้องการลดหนี้)
                  </span>
                </TableHead>
                <TableHead className="text-right">รวม</TableHead>
                <TableHead className="min-w-[11rem]">
                  รับคืนสินค้าลงสต็อกหรือไม่?
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {source.items.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="py-8 text-center text-slate-500">
                    บิลต้นทางไม่มีรายการสินค้า
                  </TableCell>
                </TableRow>
              ) : (
                source.items.map((item, index) => {
                  const draft = lines[index];
                  const qty = parseQtyInput(draft?.qty ?? "0");
                  const over = qtyExceedsLimit(qty, item.remaining_qty);
                  const lineTotal = lineTotals[index] ?? 0;
                  const isReturnToInventory = Boolean(
                    draft?.return_to_inventory && !item.is_service,
                  );
                  const unitPriceLocked = isReturnToInventory;
                  const returnDisabled =
                    isSubmitting || item.is_service || item.remaining_qty <= 0;
                  return (
                    <TableRow key={item.source_item_id}>
                      <TableCell>
                        <div className="flex items-start gap-3">
                          <LineItemProductThumb
                            imageUrl={item.image_url}
                            alt={item.description}
                          />
                          <div className="min-w-0">
                            <p className="font-mono text-xs text-slate-500">
                              {item.sku ?? "—"}
                            </p>
                            <p className="text-sm font-medium text-slate-900">
                              {item.description}
                            </p>
                            {item.is_service ? (
                              <p className="mt-0.5 text-xs text-amber-700">
                                งานบริการ — ไม่รับคืนสต็อก
                              </p>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatQty(item.source_qty)} {item.uom_used}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {formatQty(item.remaining_qty)}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="any"
                          className="h-9 text-right"
                          disabled={isSubmitting || item.remaining_qty <= 0}
                          value={draft?.qty ?? "0"}
                          onChange={(event) =>
                            updateLine(item.source_item_id, {
                              qty: event.target.value,
                            })
                          }
                        />
                        {over ? (
                          <p className="mt-1 text-[11px] font-medium text-red-600">
                            เกินยอดคงเหลือ
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          step="0.01"
                          className="h-9 text-right"
                          disabled={
                            isSubmitting ||
                            item.remaining_qty <= 0 ||
                            unitPriceLocked
                          }
                          value={
                            unitPriceLocked
                              ? formatUnitPrice(item.unit_price)
                              : (draft?.unit_price ??
                                formatUnitPrice(item.unit_price))
                          }
                          aria-label="ราคา/หน่วย (ยอดที่ต้องการลดหนี้)"
                          onChange={(event) =>
                            updateLine(item.source_item_id, {
                              unit_price: event.target.value,
                            })
                          }
                        />
                        {unitPriceLocked ? (
                          <p className="mt-1 text-[11px] text-slate-400">
                            ล็อคราคาบิลต้นทาง
                          </p>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm font-semibold">
                        {formatMoney(lineTotal)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={
                              !item.is_service &&
                              Boolean(draft?.return_to_inventory)
                            }
                            disabled={returnDisabled}
                            onCheckedChange={(checked) =>
                              updateLine(item.source_item_id, {
                                return_to_inventory: item.is_service
                                  ? false
                                  : checked,
                              })
                            }
                            aria-label="รับคืนสินค้าลงสต็อกหรือไม่ (Return to Inventory)"
                          />
                          <span className="text-xs text-slate-600">
                            {item.is_service
                              ? "ไม่รับคืน"
                              : draft?.return_to_inventory
                                ? "รับคืนสต็อก"
                                : "ลดหนี้อย่างเดียว"}
                          </span>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="border-slate-200 shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">สรุปยอดใบลดหนี้</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:max-w-sm sm:ml-auto">
          <div className="flex justify-between text-slate-600">
            <span>รวมสินค้า</span>
            <span className="font-mono">{formatMoney(billSummary.total_amount)}</span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>ส่วนลดท้ายบิล</span>
            <span className="font-mono">
              {formatMoney(billSummary.discount_amount)}
            </span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>มูลค่าก่อน VAT</span>
            <span className="font-mono">
              {formatMoney(billSummary.net_before_vat)}
            </span>
          </div>
          <div className="flex justify-between text-slate-600">
            <span>VAT {source.vat_rate}%</span>
            <span className="font-mono">{formatMoney(billSummary.vat_amount)}</span>
          </div>
          <div className="flex justify-between border-t border-slate-200 pt-2 text-base font-semibold text-slate-900">
            <span>ยอดลดหนี้</span>
            <span className="font-mono">{formatMoney(billSummary.grand_total)}</span>
          </div>
          {exceedsGrand ? (
            <p className="text-xs font-medium text-red-600">
              ยอดรวมเกินยอดคงเหลือของบิลต้นทาง (
              {formatMoney(source.remaining_grand_total)})
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
