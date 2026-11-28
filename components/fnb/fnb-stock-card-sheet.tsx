"use client";

import { useEffect, useState, useTransition } from "react";
import { Package } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getFnbItemStockCardAction } from "@/lib/actions/fnb-inventory";
import { formatShortDateTH, formatTimeHHMM } from "@/lib/utils/fnb-format";
import { locationShortLabel } from "@/lib/utils/fnb-location-label";
import type { FnbStockCard, FnbStorageZone } from "@/types/fnb";

function isoDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(date);
}

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
}

function qty(value: number): string {
  return value.toLocaleString("th-TH", { maximumFractionDigits: 2 });
}

function movementKind(type: string, inbound: number, outbound: number): "IN" | "OUT" | "ADJ" {
  const key = type.toUpperCase();
  if (key.includes("ADJ") || key.includes("COUNT") || key.includes("CYCLE")) return "ADJ";
  if (outbound > 0 && inbound === 0) return "OUT";
  if (inbound > 0) return "IN";
  return "ADJ";
}

function badgeClass(kind: "IN" | "OUT" | "ADJ"): string {
  if (kind === "IN") return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  if (kind === "OUT") return "bg-rose-50 text-rose-700 ring-rose-200";
  return "bg-amber-50 text-amber-800 ring-amber-200";
}

export function FnbStockCardSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: string;
  itemId: string;
  category: string;
  zones: FnbStorageZone[];
  fromDate?: string;
  toDate?: string;
}) {
  const [from, setFrom] = useState(props.fromDate || isoDaysAgo(30));
  const [to, setTo] = useState(props.toDate || today());
  const [zone, setZone] = useState("ALL");
  const [unit, setUnit] = useState<"count" | "recipe">("count");
  const [card, setCard] = useState<FnbStockCard | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => { if (props.fromDate) setFrom(props.fromDate); }, [props.fromDate, props.open]);
  useEffect(() => { if (props.toDate) setTo(props.toDate); }, [props.toDate, props.open]);
  useEffect(() => {
    if (!props.open || !props.itemId || !props.branch) return;
    let active = true;
    start(async () => {
      const loaded = await getFnbItemStockCardAction({
        branch_code: props.branch,
        item_id: props.itemId,
        location_code: zone,
        from_date: from,
        to_date: to,
      });
      if (!active) return;
      if (loaded.error) toast.error(loaded.error);
      setCard(loaded.data);
    });
    return () => { active = false; };
  }, [props.open, props.branch, props.itemId, zone, from, to]);
  const countMode = unit === "count";
  const brought = countMode ? card?.brought_forward_count_qty ?? 0 : card?.brought_forward_recipe_qty ?? 0;
  const closing = countMode ? card?.closing_count_qty ?? 0 : card?.closing_recipe_qty ?? 0;
  const uom = countMode ? card?.count_uom ?? "" : card?.recipe_uom ?? "";
  return (
    <Sheet open={props.open} onOpenChange={props.onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-3xl">
        <SheetHeader>
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-red-50 text-[var(--fnb-brand)]">
              <Package className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <SheetTitle className="font-mono text-sm tracking-tight">{card?.short_code || "บัตรสต็อก (Stock Card)"}</SheetTitle>
              <SheetDescription className="mt-0.5 text-sm font-medium text-slate-700">{card?.name_th || "ความเคลื่อนไหวสินค้าคงคลัง"}</SheetDescription>
              {props.category ? <p className="mt-2 text-[11px] text-slate-500">{props.category}</p> : null}
            </div>
            <div className="shrink-0 text-right">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">คงเหลือปลายงวด</p>
              <p className="text-xl font-bold tabular-nums text-slate-900">{qty(card?.closing_count_qty ?? 0)}</p>
              <p className="text-[11px] text-slate-400">{card?.count_uom}</p>
            </div>
          </div>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto px-6 py-4">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`rounded-full px-3 py-1 text-xs font-semibold ${zone === "ALL" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"}`} onClick={() => setZone("ALL")}>ทั้งหมด</button>
            {props.zones.map((row) => {
              const label = locationShortLabel(row.locationCode, row.locationNameTh, row.shortLabel);
              return <button key={row.locationCode} type="button" title={row.locationNameTh} className={`rounded-full px-3 py-1 text-xs font-semibold ${zone === row.locationCode ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"}`} onClick={() => setZone(row.locationCode)}>{label}</button>;
            })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input className="h-9 rounded-md border border-slate-200 px-2 text-sm" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
            <input className="h-9 rounded-md border border-slate-200 px-2 text-sm" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            <button type="button" className={`rounded-full px-3 py-1 text-xs ${countMode ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => setUnit("count")}>หน่วยนับ</button>
            <button type="button" className={`rounded-full px-3 py-1 text-xs ${countMode ? "bg-slate-100" : "bg-[var(--fnb-brand)] text-white"}`} onClick={() => setUnit("recipe")}>หน่วยสูตร {card?.recipe_uom}</button>
            <button type="button" className="ml-auto rounded-md border border-slate-200 px-3 py-1 text-xs" disabled={!card} onClick={() => {
              if (!card) return;
              const sheet = XLSX.utils.json_to_sheet([
                { วันเวลา: "ยอดยกมา", ประเภท: "", ผู้ทำรายการ: "", รับ: brought, จ่าย: "", คงเหลือ: brought },
                ...card.movements.map((row) => ({
                  วันเวลา: `${formatShortDateTH(row.tx_datetime_th)} ${formatTimeHHMM(row.tx_datetime_th)}`,
                  ประเภท: row.tx_type,
                  ผู้ทำรายการ: row.actor_name,
                  รับ: countMode ? row.in_count_qty : row.in_recipe_qty,
                  จ่าย: countMode ? row.out_count_qty : row.out_recipe_qty,
                  คงเหลือ: countMode ? row.balance_count_qty : row.balance_recipe_qty,
                })),
                { วันเวลา: "ยอดคงเหลือปลายงวด", ประเภท: "", ผู้ทำรายการ: "", รับ: "", จ่าย: "", คงเหลือ: closing },
              ]);
              const book = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(book, sheet, "StockCard");
              XLSX.writeFile(book, `fnb-stock-card-${card.short_code}.xlsx`);
            }}>📥 ดาวน์โหลด .xlsx</button>
          </div>
          {pending ? <p className="text-sm text-slate-500">กำลังอ่านความเคลื่อนไหว...</p> : null}
          {(card?.expiry_lots.length ?? 0) > 0 ? (
            <div className="flex flex-wrap gap-2 text-xs">
              {card?.expiry_lots.map((lot) => (
                <span key={`${lot.location_code}-${lot.expiry_date}-${lot.qty}`} className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 whitespace-nowrap">{formatShortDateTH(lot.expiry_date)} · {qty(lot.qty)} {lot.uom}</span>
              ))}
            </div>
          ) : null}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="bg-slate-50/90 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="h-9 px-3">วันที่</th>
                  <th className="h-9 px-3">ประเภท</th>
                  <th className="h-9 px-3 text-right">รับ</th>
                  <th className="h-9 px-3 text-right">จ่าย</th>
                  <th className="h-9 px-3 text-right">คงเหลือ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                <tr className="bg-slate-50/50">
                  <td className="px-3 py-2.5 text-slate-400">—</td>
                  <td className="px-3 py-2.5 font-semibold text-slate-800" colSpan={3}>ยอดยกมา (Brought Forward)</td>
                  <td className="px-3 py-2.5 text-right font-bold tabular-nums">{qty(brought)} {uom}</td>
                </tr>
                {(card?.movements ?? []).map((row) => {
                  const inbound = countMode ? row.in_count_qty : row.in_recipe_qty;
                  const outbound = countMode ? row.out_count_qty : row.out_recipe_qty;
                  const balance = countMode ? row.balance_count_qty : row.balance_recipe_qty;
                  const kind = movementKind(row.tx_type, inbound, outbound);
                  return (
                    <tr key={row.id}>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <p className="font-medium text-slate-700">{formatShortDateTH(row.tx_datetime_th)} {formatTimeHHMM(row.tx_datetime_th)}</p>
                        <p className="text-[11px] text-slate-400">{row.actor_name || "—"}</p>
                      </td>
                      <td className="px-3 py-2.5"><span className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${badgeClass(kind)}`}>{kind}</span></td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${inbound ? "font-semibold text-emerald-600" : "text-slate-300"}`}>{inbound ? qty(inbound) : "—"}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums ${outbound ? "font-semibold text-rose-600" : "text-slate-300"}`}>{outbound ? qty(outbound) : "—"}</td>
                      <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{qty(balance)} {uom}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t bg-slate-50/80">
                  <td className="px-3 py-2.5 text-right text-xs font-semibold" colSpan={4}>ยอดคงเหลือปลายงวด</td>
                  <td className="px-3 py-2.5 text-right text-sm font-bold tabular-nums">{qty(closing)} {uom}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
