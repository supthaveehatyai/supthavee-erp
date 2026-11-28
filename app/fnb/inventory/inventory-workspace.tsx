"use client";

import { useCallback, useEffect, useRef, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { BranchPills, fnbBranchStorageKey, useStoredBranch } from "@/components/fnb/branch-pills";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { ItemSlideShowPreview } from "@/components/fnb/item-slide-show";
import { emptyExpiryLot, MfdExpiryLotEditor, resolvedExpiry, type ExpiryLotDraft } from "@/components/fnb/mfd-expiry-lot-editor";
import { getFnbItemStockCardAction, saveSingleInventoryItemCountAction, transferFnbStockAction } from "@/lib/actions/fnb-inventory";
import { listBranchZonesAction } from "@/lib/actions/fnb-store-day";
import { branchForBrand } from "@/lib/fnb/brand-branch";
import { hidesOpenPackWeight, openPackNetQty } from "@/lib/utils/fnb-expiry";
import { FNB_BRAND_THEME, FNB_STOCK_SHEET_GROUPS, type FnbBranchOption, type FnbBrandCode, type FnbStockBalanceRow, type FnbStockCard, type FnbStorageZone } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

type CountItem = {
  id: string;
  short_code: string;
  name_th: string;
  item_category: string;
  count_uom: string;
  allow_decimal_count_qty: boolean;
  recipe_per_count_uom: number;
  recipe_uom?: string;
  is_catch_weight_produce?: boolean;
  piece_uom_label?: string;
  avg_gross_grams_per_piece?: number;
  default_date_stamp_mode?: string;
  shelf_life_value?: number;
  shelf_life_unit?: string;
  tare_weight_g?: number;
  specific_gravity?: number;
  image_urls?: string[];
  image_captions?: string[];
};

export function InventoryWorkspace({
  brand,
  branches,
  balances,
  items,
  blindCount = false,
  initialBranch = "",
  actorName = "",
}: {
  brand: FnbBrandCode;
  branches: FnbBranchOption[];
  balances: FnbStockBalanceRow[];
  items: CountItem[];
  blindCount?: boolean;
  showCost?: boolean;
  initialBranch?: string;
  actorName?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<"count" | "card" | "transfer">("count");
  const [view, setView] = useState<"table" | "focus">("table");
  const [pin, setPin] = useState("");
  const [focusIndex, setFocusIndex] = useState(0);
  const [branch, setBranch] = useState(() => branchForBrand(branches, brand, initialBranch || branches[0]?.branch_code || ""));
  const storageKey = fnbBranchStorageKey(brand, actorName);
  const pickBranch = useCallback((code: string) => {
    const next = branchForBrand(branches, brand, code);
    if (!next) return;
    setBranch(next);
    localStorage.setItem(storageKey, next);
    const params = new URLSearchParams(window.location.search);
    if (params.get("branch") === next) return;
    params.set("branch", next);
    router.replace(`${pathname}?${params.toString()}`);
  }, [brand, branches, pathname, router, storageKey]);
  useStoredBranch(storageKey, branches, pickBranch);
  const seenBranch = useRef(initialBranch);
  useEffect(() => {
    if (initialBranch === seenBranch.current) return;
    seenBranch.current = initialBranch;
    const next = branchForBrand(branches, brand, initialBranch);
    if (next) setBranch(next);
  }, [brand, branches, initialBranch]);
  useEffect(() => {
    const next = branchForBrand(branches, brand, branch);
    if (next !== branch) setBranch(next);
  }, [brand, branches, branch]);
  const [zones, setZones] = useState<FnbStorageZone[]>([]);
  const [location, setLocation] = useState("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({ RAW_MATERIAL: true });
  const [packs, setPacks] = useState<Record<string, string>>({});
  const [carton, setCarton] = useState<Record<string, boolean>>({});
  const [openGrams, setOpenGrams] = useState<Record<string, string>>({});
  const [lots, setLots] = useState<Record<string, ExpiryLotDraft[]>>({});
  const [savedRow, setSavedRow] = useState<Record<string, string>>({});
  const [cardItem, setCardItem] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const tone = brand === "CHATORN" ? "fnb-chatorn" : "fnb-lucky";
  const sameBrand = branches.filter((item) => item.brand_code === brand);
  const onHand = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of balances) {
      if (row.branch_code === branch) map.set(row.item_id, row.on_hand_recipe);
    }
    return map;
  }, [balances, branch]);
  const pieceOnHand = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of balances) {
      if (row.branch_code === branch) map.set(row.item_id, row.piece_on_hand);
    }
    return map;
  }, [balances, branch]);
  useEffect(() => {
    void listBranchZonesAction(branch).then((loaded) => {
      setZones(loaded.data);
      setLocation(loaded.data[0]?.locationCode ?? "");
    });
  }, [branch]);
  const workDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const pinned = useMemo(() => {
    const query = pin.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => `${item.short_code} ${item.name_th}`.toLowerCase().includes(query));
  }, [items, pin]);
  const focusItem = pinned[Math.min(focusIndex, Math.max(pinned.length - 1, 0))];
  function lotsFor(item: CountItem): ExpiryLotDraft[] {
    return lots[item.id] ?? [emptyExpiryLot({ mode: item.default_date_stamp_mode, shelfLifeValue: item.shelf_life_value, shelfLifeUnit: item.shelf_life_unit })];
  }
  function saveOne(item: CountItem, andNext = false) {
    start(async () => {
      const fruit = item.is_catch_weight_produce === true;
      const sealed = fruit || !item.allow_decimal_count_qty ? Math.trunc(Number(packs[item.id]) || 0) : Number(packs[item.id]) || 0;
      const saved = await saveSingleInventoryItemCountAction({
        branch_code: branch,
        location_code: location,
        count_date: workDate,
        item_id: item.id,
        sealed_pack_qty: sealed,
        open_pack_gross_weight_g: hidesOpenPackWeight(item.item_category) ? 0 : Number(openGrams[item.id]) || 0,
        expiry_lots: lotsFor(item).map((lot) => ({
          entry_mode: lot.entry_mode,
          mfg_date: lot.mfg_date,
          shelf_life_value: Number(lot.shelf_life_value) || 0,
          shelf_life_unit: lot.shelf_life_unit,
          expiry_date: resolvedExpiry(lot) || "",
          qty: Number(lot.qty) || 0,
        })),
      });
      if (saved.error || !saved.data.ok) { toast.error(saved.error || "บันทึกรายการนี้ไม่สำเร็จ"); return; }
      const clock = new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" }).format(new Date(saved.data.saved_at || Date.now()));
      setSavedRow((current) => ({ ...current, [item.id]: `✅ บันทึกแล้ว · ${saved.data.saved_by || actorName} ${clock} น.` }));
      toast.success(`บันทึก ${item.short_code} แล้ว`);
      if (andNext) setFocusIndex((value) => Math.min(value + 1, Math.max(pinned.length - 1, 0)));
    });
  }
  return (
    <div className={`space-y-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">สต็อก {FNB_BRAND_THEME[brand].label}</h1>
        <Link href={`/fnb/sop-settings?brand=${brand}`} className="text-sm text-[var(--fnb-brand)]">ตั้งจุดจัดเก็บและความสะอาด</Link>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "count" ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setTab("count")}>📋 ตรวจนับสต็อกแยกจุดจัดเก็บ</button>
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "card" ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setTab("card")}>📊 บัตรสต็อก (Stock Card)</button>
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "transfer" ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setTab("transfer")}>🔄 โอนสินค้าระหว่างสาขา (เฉพาะแบรนด์เดียวกัน)</button>
      </div>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <BranchPills branches={sameBrand} active={branch} onPick={pickBranch} />
      {tab === "card" ? <StockCardPanel branch={branch} location={location} zones={zones} items={items} itemId={cardItem} setItemId={setCardItem} /> : null}
      {tab === "count" ? (
        <section className="space-y-3">
          <select className={field} value={branch} disabled={sameBrand.length <= 1} onChange={(event) => pickBranch(event.target.value)}>
            {sameBrand.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code} {item.branch_name_th}</option>)}
          </select>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={`rounded-full px-3 py-1 text-sm ${view === "focus" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setView("focus")}>🎯 โหมดนับทีละ 1 รายการ</button>
            <button type="button" className={`rounded-full px-3 py-1 text-sm ${view === "table" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setView("table")}>📑 โหมดตารางแยกหมวด</button>
            <input className="h-10 w-64 rounded-md border px-3 text-sm" value={pin} placeholder="🔍 กรองเจาะจง 1 รายการ" onChange={(event) => { setPin(event.target.value); setFocusIndex(0); }} />
          </div>
          <div className="flex flex-wrap gap-2">
            {zones.map((zone, index) => (
              <button key={zone.locationCode} type="button" className={`rounded-full px-3 py-1 text-sm ${location === zone.locationCode ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setLocation(zone.locationCode)}>{index + 1}. {zone.locationNameTh}</button>
            ))}
          </div>
          {view === "focus" && focusItem ? (
            <article className={`space-y-3 rounded-xl border bg-white p-4 ${savedRow[focusItem.id] ? "border-emerald-400" : ""}`}>
              <p className="font-semibold">{focusIndex + 1}/{pinned.length} · {focusItem.short_code} {focusItem.name_th}</p>
              <ItemSlideShowPreview title={focusItem.name_th} urls={focusItem.image_urls ?? []} captions={focusItem.image_captions ?? []} />
              <CountFields item={focusItem} packs={packs} setPacks={setPacks} openGrams={openGrams} setOpenGrams={setOpenGrams} lots={lotsFor(focusItem)} setLots={(next) => setLots((current) => ({ ...current, [focusItem.id]: next }))} showOpen={!hidesOpenPackWeight(focusItem.item_category)} carton={carton[focusItem.id] === true} setCarton={(value) => setCarton((current) => ({ ...current, [focusItem.id]: value }))} />
              {savedRow[focusItem.id] ? <p className="text-sm text-emerald-800">{savedRow[focusItem.id]}</p> : null}
              <div className="flex gap-2">
                <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => setFocusIndex((value) => Math.max(value - 1, 0))}>ก่อนหน้า</button>
                <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={pending} onClick={() => saveOne(focusItem, true)}>💾 บันทึก & ไปตัวถัดไป ➡️</button>
              </div>
            </article>
          ) : null}
          {view === "table" ? FNB_STOCK_SHEET_GROUPS.map((group) => {
            const rows = pinned.filter((item) => item.item_category === group.key);
            if (rows.length === 0) return null;
            const open = openGroups[group.key] !== false && (openGroups[group.key] === true || group.key === "RAW_MATERIAL");
            const showOpen = !hidesOpenPackWeight(group.key);
            return (
              <article key={group.key} className="rounded-xl border bg-white">
                <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold" onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !open }))}>{group.label}<span>{open ? "ซ่อน" : "เปิด"}</span></button>
                {open ? (
                  <div className="space-y-3 p-3">
                    {rows.map((row) => {
                      const fruit = row.is_catch_weight_produce === true;
                      const unit = fruit ? (row.piece_uom_label || "ลูก") : row.count_uom;
                      const system = fruit ? `${Math.round(pieceOnHand.get(row.id) ?? 0)} ${unit}` : `${((onHand.get(row.id) ?? 0) / (row.recipe_per_count_uom || 1)).toFixed(0)} ${row.count_uom}`;
                      return (
                        <div key={row.id} className={`space-y-2 rounded-lg border p-3 ${savedRow[row.id] ? "border-emerald-400 bg-emerald-50" : "border-slate-100"}`}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="font-semibold">{row.short_code} · {row.name_th}</p>
                              {blindCount ? null : <p className="text-xs text-slate-500">ยอดระบบ {system}</p>}
                              {savedRow[row.id] ? <p className="text-sm text-emerald-800">{savedRow[row.id]}</p> : null}
                            </div>
                            <ItemSlideShowPreview title={row.name_th} urls={row.image_urls ?? []} captions={row.image_captions ?? []} />
                          </div>
                          <CountFields item={row} packs={packs} setPacks={setPacks} openGrams={openGrams} setOpenGrams={setOpenGrams} lots={lotsFor(row)} setLots={(next) => setLots((current) => ({ ...current, [row.id]: next }))} showOpen={showOpen} carton={carton[row.id] === true} setCarton={(value) => setCarton((current) => ({ ...current, [row.id]: value }))} />
                          <div className="flex gap-2">
                            <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={pending || !location} onClick={() => saveOne(row)}>💾 บันทึก</button>
                            <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => { setCardItem(row.id); setTab("card"); }}>📊 ดูบัตรสต็อก</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            );
          }) : null}
        </section>
      ) : null}
      {tab === "transfer" ? (
        <form className="grid gap-2 rounded-xl border bg-white p-4 md:grid-cols-2" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          start(async () => {
            const saved = await transferFnbStockAction({
              from_branch_code: branch,
              to_branch_code: String(form.get("to_branch_code") ?? ""),
              staff_name: "",
              actor_source: "desktop",
              item_id: String(form.get("item_id") ?? ""),
              qty_in_count_uom: Math.trunc(Number(form.get("qty") ?? 0) || 0),
            });
            const note = saved.error ?? `โอน ${saved.data.transfer_no} แล้ว`;
            setMessage(note);
            if (saved.error) toast.error(saved.error);
            else toast.success(note);
          });
        }}>
          <h2 className="font-semibold md:col-span-2">โอนสินค้าระหว่างสาขา (เฉพาะแบรนด์เดียวกันเท่านั้น)</h2>
          <p className="rounded-lg bg-[var(--fnb-tint)] px-3 py-2 text-sm md:col-span-2">🔒 ล็อกโอนเฉพาะภายในแบรนด์ {FNB_BRAND_THEME[brand].label} เท่านั้น</p>
          <label className="text-sm">จากสาขา<select className={field} value={branch} disabled={sameBrand.length <= 1} onChange={(event) => pickBranch(event.target.value)}>{sameBrand.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}</select></label>
          <label className="text-sm">ไปสาขา<select className={field} name="to_branch_code">{sameBrand.filter((item) => item.branch_code !== branch).map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code}</option>)}</select></label>
          <label className="text-sm">สินค้า<select className={field} name="item_id">{items.map((item) => <option key={item.id} value={item.id}>{item.short_code} {item.name_th}</option>)}</select></label>
          <label className="text-sm">จำนวน<FnbQtyInput name="qty" unit={items[0]?.count_uom} /></label>
          <button className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white" disabled={pending}>บันทึกโอน</button>
        </form>
      ) : null}
    </div>
  );
}

function CountFields(props: {
  item: CountItem;
  packs: Record<string, string>;
  setPacks: (value: Record<string, string>) => void;
  openGrams: Record<string, string>;
  setOpenGrams: (value: Record<string, string>) => void;
  lots: ExpiryLotDraft[];
  setLots: (lots: ExpiryLotDraft[]) => void;
  showOpen: boolean;
  carton: boolean;
  setCarton: (value: boolean) => void;
}) {
  const fruit = props.item.is_catch_weight_produce === true;
  const unit = fruit ? (props.item.piece_uom_label || "ลูก") : props.item.count_uom;
  const gross = Number(props.openGrams[props.item.id]) || 0;
  const net = openPackNetQty(gross, props.item.tare_weight_g || 0, props.item.specific_gravity || 1, props.item.recipe_uom || "g");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">จำนวนแพ็คเต็ม
          <span className="mt-1 block">
            {fruit && props.carton ? <FnbQtyInput allowDecimal unit="กก." onChange={(value) => props.setPacks({ ...props.packs, [props.item.id]: String(Math.round(((Number(value) || 0) * 1000) / (props.item.avg_gross_grams_per_piece || 110))) })} /> : <FnbQtyInput value={props.packs[props.item.id] ?? ""} onChange={(value) => props.setPacks({ ...props.packs, [props.item.id]: value })} unit={unit} allowDecimal={fruit ? false : props.item.allow_decimal_count_qty} />}
          </span>
        </label>
        {fruit ? <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={props.carton} onChange={(event) => props.setCarton(event.target.checked)} /> นับลังปิดเป็น กก.</label> : null}
        {props.showOpen ? (
          <label className="text-sm">น้ำหนักแพ็คเปิดค้าง (g)
            <span className="mt-1 block"><FnbQtyInput allowDecimal unit="g" value={props.openGrams[props.item.id] ?? ""} onChange={(value) => props.setOpenGrams({ ...props.openGrams, [props.item.id]: value })} /></span>
            {gross > 0 ? <span className="text-xs text-slate-500">สุทธิหลังหักภาชนะ ~{net} {props.item.recipe_uom || "g"}</span> : null}
          </label>
        ) : null}
      </div>
      <MfdExpiryLotEditor
        lots={props.lots}
        onChange={props.setLots}
        countUom={unit}
        allowDecimal={props.item.allow_decimal_count_qty}
        expectedQty={Number(props.packs[props.item.id]) || 0}
        defaults={{ mode: props.item.default_date_stamp_mode, shelfLifeValue: props.item.shelf_life_value, shelfLifeUnit: props.item.shelf_life_unit }}
      />
    </div>
  );
}

function StockCardPanel(props: {
  branch: string;
  location: string;
  zones: FnbStorageZone[];
  items: CountItem[];
  itemId: string;
  setItemId: (id: string) => void;
}) {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [zone, setZone] = useState(props.location || "ALL");
  const [card, setCard] = useState<FnbStockCard | null>(null);
  const [pending, start] = useTransition();
  const item = props.items.find((row) => row.id === props.itemId) ?? props.items[0];
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="font-semibold">📊 บัตรสต็อก (F&B Stock Card)</h2>
      <div className="grid gap-2 md:grid-cols-5">
        <select className={field} value={item?.id ?? ""} onChange={(event) => props.setItemId(event.target.value)}>{props.items.map((row) => <option key={row.id} value={row.id}>{row.short_code} {row.name_th}</option>)}</select>
        <select className={field} value={zone} onChange={(event) => setZone(event.target.value)}>
          <option value="ALL">ทุกจุดจัดเก็บ</option>
          {props.zones.map((row) => <option key={row.locationCode} value={row.locationCode}>{row.locationNameTh}</option>)}
        </select>
        <input className={field} type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        <input className={field} type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={pending || !item} onClick={() => start(async () => {
          if (!item) return;
          const loaded = await getFnbItemStockCardAction({ branch_code: props.branch, item_id: item.id, location_code: zone, from_date: from, to_date: to });
          if (loaded.error) toast.error(loaded.error);
          setCard(loaded.data);
        })}>ดูความเคลื่อนไหว</button>
      </div>
      {card ? (
        <>
          <p className="text-sm">{card.short_code} {card.name_th} · ยอดยกมา {card.brought_forward_count_qty} {card.count_uom} · คงเหลือ {card.closing_count_qty} {card.count_uom}</p>
          <button type="button" className="rounded-md border px-3 py-1 text-sm" onClick={() => {
            const sheet = XLSX.utils.json_to_sheet([
              { วันเวลา: "ยอดยกมา", จุดจัดเก็บ: "", ผู้บันทึก: "", ประเภท: "", รับเข้า: "", จ่ายออก: "", คงเหลือ: card.brought_forward_count_qty },
              ...card.movements.map((row) => ({ วันเวลา: row.tx_datetime_th, จุดจัดเก็บ: row.location_name_th, ผู้บันทึก: row.actor_name, ประเภท: row.tx_type, รับเข้า: row.in_count_qty, จ่ายออก: row.out_count_qty, คงเหลือ: row.balance_count_qty, หมายเหตุ: row.notes })),
            ]);
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(book, sheet, "StockCard");
            XLSX.writeFile(book, `fnb-stock-card-${card.short_code}.xlsx`);
          }}>ดาวน์โหลด .xlsx</button>
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead><tr className="text-left"><th className="p-2">วัน-เวลา</th><th>จุดจัดเก็บ</th><th>ผู้บันทึก</th><th>รับเข้า</th><th>จ่ายออก</th><th>คงเหลือ</th></tr></thead>
              <tbody>
                <tr><td className="p-2">ยอดยกมา</td><td /><td /><td /><td /><td>{card.brought_forward_count_qty} {card.count_uom}</td></tr>
                {card.movements.map((row) => (
                  <tr key={row.id} className="border-t">
                    <td className="p-2">{row.tx_datetime_th}</td>
                    <td>{row.location_name_th}</td>
                    <td>{row.actor_name}</td>
                    <td>{row.in_count_qty || ""}</td>
                    <td>{row.out_count_qty || ""}</td>
                    <td>{row.balance_count_qty} {card.count_uom}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </section>
  );
}
