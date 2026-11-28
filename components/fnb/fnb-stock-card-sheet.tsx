"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getFnbItemStockCardAction } from "@/lib/actions/fnb-inventory";
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

function tone(type: string, inbound: number, outbound: number): string {
  const key = type.toUpperCase();
  if (key.includes("ADJ") || key.includes("COUNT") || key.includes("CYCLE")) return "bg-amber-100 text-amber-900";
  if (outbound > 0 && inbound === 0) return "bg-rose-100 text-rose-800";
  if (inbound > 0) return "bg-emerald-100 text-emerald-800";
  return "bg-slate-100 text-slate-700";
}

export function FnbStockCardSheet(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch: string;
  itemId: string;
  category: string;
  zones: FnbStorageZone[];
}) {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(today());
  const [zone, setZone] = useState("ALL");
  const [unit, setUnit] = useState<"count" | "recipe">("count");
  const [card, setCard] = useState<FnbStockCard | null>(null);
  const [pending, start] = useTransition();
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
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>{card?.short_code || "บัตรสต็อก"} · {card?.name_th || "กำลังโหลด"}</SheetTitle>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex flex-wrap gap-2 text-xs">
              {props.category ? <span className="rounded-full bg-slate-100 px-2 py-1">{props.category}</span> : null}
              {card ? <span className="rounded-full bg-slate-100 px-2 py-1">{card.count_uom} · {card.recipe_uom}</span> : null}
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">คงเหลือปลายงวด</p>
              <p className="text-2xl font-bold text-slate-900">{qty(card?.closing_count_qty ?? 0)} {card?.count_uom}</p>
              <p className="text-xs text-slate-500">{qty(card?.closing_recipe_qty ?? 0)} {card?.recipe_uom}</p>
            </div>
          </div>
        </SheetHeader>
        <div className="space-y-3 px-6 py-4">
          <div className="grid gap-2 md:grid-cols-2">
            <select className="h-10 rounded-md border px-2 text-sm" value={zone} onChange={(event) => setZone(event.target.value)}>
              <option value="ALL">ทุกจุดจัดเก็บ</option>
              {props.zones.map((row) => <option key={row.locationCode} value={row.locationCode}>{row.locationNameTh}</option>)}
            </select>
            <div className="flex gap-2">
              <input className="h-10 w-full rounded-md border px-2 text-sm" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
              <input className="h-10 w-full rounded-md border px-2 text-sm" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="rounded-full bg-slate-100 px-3 py-1 text-xs" onClick={() => { setFrom(isoDaysAgo(30)); setTo(today()); }}>30 วันล่าสุด</button>
            <button type="button" className={`rounded-full px-3 py-1 text-xs ${countMode ? "bg-[var(--fnb-brand)] text-white" : "bg-slate-100"}`} onClick={() => setUnit("count")}>หน่วยนับแพ็ค</button>
            <button type="button" className={`rounded-full px-3 py-1 text-xs ${countMode ? "bg-slate-100" : "bg-[var(--fnb-brand)] text-white"}`} onClick={() => setUnit("recipe")}>หน่วยสูตร {card?.recipe_uom}</button>
            <button type="button" className="rounded-md border px-3 py-1 text-xs" disabled={!card} onClick={() => {
              if (!card) return;
              const sheet = XLSX.utils.json_to_sheet([
                { วันเวลา: "ยอดยกมา", จุดจัดเก็บ: "", ประเภท: "", ผู้ทำรายการ: "", รับ: brought, จ่าย: "", คงเหลือ: brought },
                ...card.movements.map((row) => ({
                  วันเวลา: row.tx_datetime_th,
                  จุดจัดเก็บ: row.location_name_th,
                  ประเภท: row.tx_type,
                  ผู้ทำรายการ: row.actor_name,
                  รับ: countMode ? row.in_count_qty : row.in_recipe_qty,
                  จ่าย: countMode ? row.out_count_qty : row.out_recipe_qty,
                  คงเหลือ: countMode ? row.balance_count_qty : row.balance_recipe_qty,
                  หมายเหตุ: row.notes,
                })),
                { วันเวลา: "ยอดคงเหลือปลายงวด", จุดจัดเก็บ: "", ประเภท: "", ผู้ทำรายการ: "", รับ: "", จ่าย: "", คงเหลือ: closing },
              ]);
              const book = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(book, sheet, "StockCard");
              XLSX.writeFile(book, `fnb-stock-card-${card.short_code}.xlsx`);
            }}>📥 ดาวน์โหลดบัตรสต็อก (.xlsx)</button>
          </div>
          {pending ? <p className="text-sm text-slate-500">กำลังอ่านความเคลื่อนไหว...</p> : null}
          {(card?.expiry_lots.length ?? 0) > 0 ? (
            <div className="flex flex-wrap gap-2 text-xs">
              {card?.expiry_lots.map((lot) => (
                <span key={`${lot.expiry_date}-${lot.qty}`} className="rounded-full bg-amber-50 px-2 py-1">{lot.mfg_date || lot.entry_mode} → {lot.expiry_date} : {qty(lot.qty)} {lot.uom}</span>
              ))}
            </div>
          ) : null}
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500"><th className="py-2">วัน-เวลา</th><th>จุดจัดเก็บ</th><th>ประเภท</th><th>ผู้ทำรายการ</th><th>รับ</th><th>จ่าย</th><th>คงเหลือ</th></tr></thead>
              <tbody>
                <tr className="border-t font-medium"><td className="py-2">ยอดยกมา (Brought Forward)</td><td /><td /><td /><td /><td /><td>{qty(brought)} {uom}</td></tr>
                {(card?.movements ?? []).map((row) => {
                  const inbound = countMode ? row.in_count_qty : row.in_recipe_qty;
                  const outbound = countMode ? row.out_count_qty : row.out_recipe_qty;
                  const balance = countMode ? row.balance_count_qty : row.balance_recipe_qty;
                  return (
                    <tr key={row.id} className="border-t">
                      <td className="py-2">{row.tx_datetime_th}</td>
                      <td>{row.location_name_th}</td>
                      <td><span className={`rounded px-1.5 py-0.5 text-xs ${tone(row.tx_type, inbound, outbound)}`}>{row.tx_type}</span></td>
                      <td>{row.actor_name}</td>
                      <td>{inbound || ""}</td>
                      <td>{outbound || ""}</td>
                      <td className="font-semibold">{qty(balance)} {uom}</td>
                    </tr>
                  );
                })}
                <tr className="border-t font-semibold"><td className="py-2">ยอดคงเหลือปลายงวด</td><td /><td /><td /><td /><td /><td>{qty(closing)} {uom}</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
