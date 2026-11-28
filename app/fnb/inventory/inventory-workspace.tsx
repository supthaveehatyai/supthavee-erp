"use client";

import { useCallback, useEffect, useRef, useMemo, useState, useTransition, type FormEvent } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Package, RotateCcw, Search, X } from "lucide-react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { BranchPills, fnbBranchStorageKey, useStoredBranch } from "@/components/fnb/branch-pills";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { ItemSlideShowPreview } from "@/components/fnb/item-slide-show";
import { emptyExpiryLot, MfdExpiryLotEditor, resolvedExpiry, type ExpiryLotDraft } from "@/components/fnb/mfd-expiry-lot-editor";
import { FnbStockCardSheet } from "@/components/fnb/fnb-stock-card-sheet";
import { getExecutiveInventoryOverviewAction, saveSingleInventoryItemCountAction, transferFnbStockAction } from "@/lib/actions/fnb-inventory";
import { listBranchZonesAction } from "@/lib/actions/fnb-store-day";
import { branchForBrand } from "@/lib/fnb/brand-branch";
import { hidesOpenPackWeight, openPackNetQty } from "@/lib/utils/fnb-expiry";
import { formatFnbQty, formatShortDateTH, formatTimeHHMM } from "@/lib/utils/fnb-format";
import { FNB_OVERVIEW_CATEGORIES, inventorySubgroup, subgroupOrder } from "@/lib/utils/fnb-inventory-groups";
import { locationShortLabel } from "@/lib/utils/fnb-location-label";
import { FNB_BRAND_THEME, type FnbBranchOption, type FnbBrandCode, type FnbExecutiveInventory, type FnbExecutiveInventoryItem, type FnbStockBalanceRow, type FnbStorageZone } from "@/types/fnb";

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
  display_sub_group?: string;
};

export function InventoryWorkspace({
  brand,
  branches,
  balances,
  items,
  blindCount = false,
  showCost = false,
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
  const [tab, setTab] = useState<"work" | "transfer">("work");
  const [lens, setLens] = useState<"executive" | "count">(blindCount ? "count" : "executive");
  const [overview, setOverview] = useState<FnbExecutiveInventory | null>(null);
  const [ledgerFrom, setLedgerFrom] = useState("");
  const [ledgerTo, setLedgerTo] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
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
  useEffect(() => {
    if (lens !== "executive" || !branch) return;
    let active = true;
    void getExecutiveInventoryOverviewAction(branch).then((loaded) => {
      if (!active) return;
      if (loaded.error) toast.error(loaded.error);
      setOverview(loaded.data);
    });
    return () => { active = false; };
  }, [branch, lens]);
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
  const mode = tab === "transfer" ? "transfer" : lens;
  return (
    <div className={`flex flex-col gap-6 ${tone}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex flex-col gap-2">
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight text-slate-900">📦 บัตรสต็อก (Inventory Overview)</h1>
          <p className="text-sm text-slate-500">หมวดหมู่ → กลุ่มย่อย → รายการวัตถุดิบ · กดดูความเคลื่อนไหวเพื่อเปิด Ledger แบบ Slide-over</p>
        </div>
        <div className="flex flex-col items-start gap-2 lg:items-end">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${mode === "executive" ? "bg-slate-900 text-white" : "border border-slate-200 bg-white text-slate-700"}`} onClick={() => { setTab("work"); setLens("executive"); }}>[ 👔 ภาพรวมสต็อก (Overview) ]</button>
            <button type="button" className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${mode === "count" ? "bg-[var(--fnb-brand)] text-white" : "border border-slate-200 bg-white text-slate-700"}`} onClick={() => { setTab("work"); setLens("count"); }}>[ ✍️ คีย์ตรวจนับหน้างาน ]</button>
            <button type="button" className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${mode === "transfer" ? "bg-[var(--fnb-brand)] text-white" : "border border-slate-200 bg-white text-slate-700"}`} onClick={() => setTab("transfer")}>[ 🔄 โอนระหว่างสาขา ]</button>
          </div>
          <BranchPills branches={sameBrand} active={branch} onPick={pickBranch} />
          <Link href={`/fnb/sop-settings?brand=${brand}`} className="text-xs text-[var(--fnb-brand)]">ตั้งชื่อย่อจุดจัดเก็บ</Link>
        </div>
      </div>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <FnbStockCardSheet open={sheetOpen} onOpenChange={setSheetOpen} branch={branch} itemId={cardItem} category={items.find((item) => item.id === cardItem)?.item_category || overview?.items.find((item) => item.item_id === cardItem)?.item_category || ""} zones={zones} fromDate={ledgerFrom} toDate={ledgerTo} />
      {tab === "work" && lens === "executive" ? <ExecutiveOverview overview={overview} zones={zones} showCost={showCost} fromDate={ledgerFrom} toDate={ledgerTo} onDates={(from, to) => { setLedgerFrom(from); setLedgerTo(to); }} onOpen={(itemId) => { setCardItem(itemId); setSheetOpen(true); }} /> : null}
      {tab === "work" && lens === "count" ? (
        <section className="space-y-3">
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
                <MovementButton onClick={() => { setCardItem(focusItem.id); setSheetOpen(true); }} />
                <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={pending} onClick={() => saveOne(focusItem, true)}>💾 บันทึก & ไปตัวถัดไป ➡️</button>
              </div>
            </article>
          ) : null}
          {view === "table" ? (
            <div className="flex justify-end gap-2">
              <button type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold" onClick={() => setOpenGroups(Object.fromEntries(FNB_OVERVIEW_CATEGORIES.map((group) => [group.key, true])))}>ขยายทุกหมวด</button>
              <button type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold" onClick={() => setOpenGroups(Object.fromEntries(FNB_OVERVIEW_CATEGORIES.map((group) => [group.key, false])))}>ยุบทุกหมวด</button>
            </div>
          ) : null}
          {view === "table" ? FNB_OVERVIEW_CATEGORIES.map((group) => {
            const rows = pinned.filter((item) => item.item_category === group.key);
            if (rows.length === 0) return null;
            const open = openGroups[group.key] !== false;
            const counted = rows.filter((row) => savedRow[row.id]).length;
            const names = [...new Set(rows.map((row) => inventorySubgroup(group.key, row.name_th, row.display_sub_group)))];
            const subgroups = subgroupOrder(group.key, names);
            const showOpen = !hidesOpenPackWeight(group.key);
            return (
              <article key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <button type="button" className="flex w-full items-center gap-3 bg-slate-50/80 px-5 py-3.5 text-left" onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !open }))}>
                  <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">CATEGORY</span>
                  <span className="text-sm font-semibold text-slate-800">{group.label}</span>
                  <span className="text-[11px] text-slate-500">นับแล้ว {counted} / {rows.length} รายการ</span>
                  <span className="ml-auto text-sm text-slate-500">{open ? "⌃" : "⌄"}</span>
                </button>
                {open ? subgroups.map((name) => {
                  const section = name ? rows.filter((row) => inventorySubgroup(group.key, row.name_th, row.display_sub_group) === name) : rows;
                  const subKey = `${group.key}:${name || "all"}`;
                  const subOpen = openGroups[subKey] !== false;
                  return (
                    <div key={subKey}>
                      {name ? <button type="button" className="flex w-full items-center justify-between bg-slate-50/90 px-4 py-1.5 text-left text-xs font-semibold text-slate-700" onClick={() => setOpenGroups((current) => ({ ...current, [subKey]: !subOpen }))}><span>{name}</span><span>{subOpen ? "⌃" : "⌄"}</span></button> : null}
                      {subOpen ? section.map((row) => {
                        const fruit = row.is_catch_weight_produce === true;
                        const unit = fruit ? (row.piece_uom_label || "ลูก") : row.count_uom;
                        const system = fruit ? `${Math.round(pieceOnHand.get(row.id) ?? 0)} ${unit}` : `${((onHand.get(row.id) ?? 0) / (row.recipe_per_count_uom || 1)).toFixed(0)} ${row.count_uom}`;
                        return (
                          <div key={row.id} className={`space-y-2 border-t p-3 ${savedRow[row.id] ? "bg-emerald-50" : "bg-white"}`}>
                            <div className="flex items-center gap-2">
                              <ItemThumb title={row.name_th} urls={row.image_urls ?? []} captions={row.image_captions ?? []} />
                              <div>
                                <span className="font-mono text-sm font-bold text-slate-900">{row.short_code}</span>
                                <span className="block text-xs leading-tight text-slate-500">{row.name_th}</span>
                                {blindCount ? null : <p className="text-xs text-slate-500">ยอดระบบ {system}</p>}
                                {savedRow[row.id] ? <p className="text-sm text-emerald-800">{savedRow[row.id]}</p> : null}
                              </div>
                            </div>
                            <CountFields item={row} packs={packs} setPacks={setPacks} openGrams={openGrams} setOpenGrams={setOpenGrams} lots={lotsFor(row)} setLots={(next) => setLots((current) => ({ ...current, [row.id]: next }))} showOpen={showOpen} carton={carton[row.id] === true} setCarton={(value) => setCarton((current) => ({ ...current, [row.id]: value }))} />
                            <div className="flex gap-2">
                              <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-3 py-2 text-sm text-white" disabled={pending || !location} onClick={() => saveOne(row)}>💾 บันทึก</button>
                              <MovementButton onClick={() => { setCardItem(row.id); setSheetOpen(true); }} />
                            </div>
                          </div>
                        );
                      }) : null}
                    </div>
                  );
                }) : null}
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

function ItemThumb(props: { title: string; urls: string[]; captions: string[] }) {
  if (props.urls.filter(Boolean).length === 0) {
    return <span className="flex h-8 w-8 items-center justify-center rounded-md bg-slate-100 text-slate-300"><Package className="h-4 w-4" /></span>;
  }
  return <ItemSlideShowPreview title={props.title} urls={props.urls} captions={props.captions} compact />;
}

function MovementButton(props: { onClick: () => void }) {
  return (
    <button type="button" onClick={props.onClick} className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium whitespace-nowrap text-slate-700 shadow-2xs transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900">
      <RotateCcw className="h-3.5 w-3.5 text-slate-500" />
      ดูความเคลื่อนไหว
    </button>
  );
}

type StockPill = "all" | "negative" | "positive" | "fefo" | "low";

function expiryTone(iso: string): string {
  if (!iso) return "";
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const days = Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(today)) / 86400000);
  if (days <= 7) return "rounded bg-red-50 px-1.5 font-semibold text-red-700";
  if (days <= 14) return "rounded bg-amber-50 px-1.5 font-semibold text-amber-800";
  return "text-slate-700";
}

function zoneNegative(row: FnbExecutiveInventoryItem): boolean {
  return Object.values(row.by_location_count_qty).some((qty) => qty < 0);
}

function ExecutiveOverview(props: {
  overview: FnbExecutiveInventory | null;
  zones: FnbStorageZone[];
  showCost: boolean;
  fromDate: string;
  toDate: string;
  onDates: (from: string, to: string) => void;
  onOpen: (itemId: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [pill, setPill] = useState<StockPill>("all");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 14);
  const horizonIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(horizon);
  const rows = props.overview?.items ?? [];
  const locations = (props.overview?.locations.length ? props.overview.locations : props.zones.map((zone) => ({ location_code: zone.locationCode, location_name_th: zone.locationNameTh, short_label: zone.shortLabel }))).map((zone) => ({
    ...zone,
    short_label: locationShortLabel(zone.location_code, zone.location_name_th, zone.short_label),
  }));
  const visible = rows.filter((row) => {
    const low = row.total_count_qty < 0 || (row.reorder_point_count_qty > 0 && row.total_count_qty < row.reorder_point_count_qty);
    const near = Boolean(row.nearest_expiry_date && row.nearest_expiry_date <= horizonIso);
    if (pill === "negative" && !(row.total_count_qty < 0 || zoneNegative(row))) return false;
    if (pill === "positive" && !(row.total_count_qty > 0)) return false;
    if (pill === "fefo" && !near) return false;
    if (pill === "low" && !low) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${row.short_code} ${row.name_th}`.toLowerCase().includes(needle);
  });
  function onSearch(event: FormEvent) {
    event.preventDefault();
    setQuery(draft.trim());
  }
  function download() {
    const sheet = XLSX.utils.json_to_sheet(visible.map((row) => ({
      รหัส: row.short_code,
      ชื่อ: row.name_th,
      คงเหลือ: row.total_count_qty,
      หน่วย: row.count_uom,
      ทุนต่อหน่วย: props.showCost ? row.unit_cost_per_count_uom ?? "" : "",
      มูลค่า: props.showCost ? row.total_stock_value_thb ?? "" : "",
      หมดอายุใกล้สุด: formatShortDateTH(row.nearest_expiry_date),
      นับล่าสุด: formatShortDateTH(row.last_counted_at),
      ผู้บันทึก: row.last_counted_by,
    })));
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Stock");
    XLSX.writeFile(book, `fnb-stock-${props.overview?.branch_code || "branch"}.xlsx`);
  }
  const pills: [StockPill, string][] = [
    ["all", "ทั้งหมด (All)"],
    ["negative", "🔴 เฉพาะสต็อกติดลบ (< 0)"],
    ["positive", "🟢 มีสินค้าคงเหลือ (> 0)"],
    ["fefo", "🟠 ใกล้หมดอายุ (≤ 14 วัน)"],
    ["low", "⚠️ ต่ำกว่าจุดเตือน"],
  ];
  return (
    <section className="flex flex-col gap-4">
      <form onSubmit={onSearch} className="grid gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-xs lg:grid-cols-[minmax(0,1.8fr)_repeat(2,minmax(0,1fr))_auto]">
        <div className="space-y-1.5">
          <label htmlFor="fnb-inventory-q" className="text-xs font-medium text-slate-600">ค้นหารหัส / ชื่อวัตถุดิบ</label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input id="fnb-inventory-q" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="เว้นว่าง = แสดงทุกรายการ · หรือพิมพ์รหัส/ชื่อไทย..." className="h-11 w-full rounded-md border border-slate-200 bg-white pr-3 pl-9 text-sm" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-600">ตั้งแต่วันที่ (Ledger)</label>
          <input type="date" value={props.fromDate} onChange={(event) => props.onDates(event.target.value, props.toDate)} className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-slate-600">ถึงวันที่ (Ledger)</label>
          <input type="date" value={props.toDate} onChange={(event) => props.onDates(props.fromDate, event.target.value)} className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm" />
        </div>
        <div className="flex items-end gap-2">
          <button type="submit" className="h-11 rounded-md bg-[var(--fnb-brand)] px-4 text-sm font-semibold text-white">ค้นหา</button>
          <button type="button" className="inline-flex h-11 items-center gap-1.5 rounded-md border border-slate-200 px-3 text-sm" onClick={() => { setDraft(""); setQuery(""); props.onDates("", ""); }}><X className="h-3.5 w-3.5" />ล้าง</button>
          <button type="button" className="h-11 rounded-md border border-slate-200 px-3 text-sm" onClick={download}>📥 ดาวน์โหลด .xlsx</button>
        </div>
      </form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          {pills.map(([id, label]) => (
            <button key={id} type="button" className={pill === id ? "rounded-full bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white" : "rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"} onClick={() => setPill(id)}>{label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold" onClick={() => setOpenGroups(Object.fromEntries(FNB_OVERVIEW_CATEGORIES.map((group) => [group.key, true])))}>ขยายทุกหมวด</button>
          <button type="button" className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold" onClick={() => setOpenGroups(Object.fromEntries(FNB_OVERVIEW_CATEGORIES.map((group) => [group.key, false])))}>ยุบทุกหมวด</button>
        </div>
      </div>
      {visible.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-500">ไม่พบวัตถุดิบตามเงื่อนไขค้นหา</div> : null}
      <div className="flex flex-col gap-5">
        {FNB_OVERVIEW_CATEGORIES.map((group) => {
          const section = visible.filter((row) => row.item_category === group.key);
          if (section.length === 0) return null;
          const open = openGroups[group.key] !== false;
          const inStock = section.filter((row) => row.total_count_qty > 0).length;
          const negative = section.filter((row) => row.total_count_qty < 0 || zoneNegative(row)).length;
          const value = section.reduce((sum, row) => sum + (row.total_stock_value_thb ?? 0), 0);
          const names = [...new Set(section.map((row) => inventorySubgroup(group.key, row.name_th, row.display_sub_group)))];
          const subgroups = subgroupOrder(group.key, names);
          return (
            <article key={group.key} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <button type="button" className="flex w-full items-center gap-3 bg-slate-50/80 px-5 py-3.5 text-left" onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !open }))}>
                <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">CATEGORY</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-slate-800">{group.label}</span>
                  <span className="text-[11px] text-slate-500">{section.length} รายการ · มีของคงเหลือ {inStock} รายการ</span>
                  {negative > 0 ? <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700">ติดลบ {negative}</span> : null}
                </span>
                <span className="text-right text-xs text-slate-600">มีของ {inStock} รายการ{props.showCost ? ` · มูลค่ารวม ฿${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ""} <span className="ml-2">{open ? "⌃" : "⌄"}</span></span>
              </button>
              {open ? subgroups.map((name) => {
                const lines = name ? section.filter((row) => inventorySubgroup(group.key, row.name_th, row.display_sub_group) === name) : section;
                const subKey = `${group.key}:${name || "all"}`;
                const subOpen = openGroups[subKey] !== false;
                return (
                  <div key={subKey}>
                    {name ? <button type="button" className="flex w-full items-center justify-between bg-slate-50/90 px-4 py-1.5 text-left text-xs font-semibold text-slate-700" onClick={() => setOpenGroups((current) => ({ ...current, [subKey]: !subOpen }))}><span>{name}</span><span>{subOpen ? "⌃" : "⌄"}</span></button> : null}
                    {subOpen ? (
                      <div className="overflow-auto">
                        <table className="min-w-full text-left">
                          <thead>
                            <tr className="bg-slate-50/90 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              <th className="h-9 px-3">รหัส / ชื่อสินค้า</th>
                              <th className="h-9 px-3">แยกตามจุดจัดเก็บ</th>
                              <th className="h-9 px-3 text-right">คงเหลือ</th>
                              {props.showCost ? <th className="h-9 px-3 text-right">Unit Cost</th> : null}
                              {props.showCost ? <th className="h-9 px-3 text-right">Value</th> : null}
                              <th className="h-9 px-3">ใกล้หมดอายุ</th>
                              <th className="h-9 px-3">นับล่าสุด</th>
                              <th className="h-9 px-3 text-right">การทำงาน</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {lines.map((row) => (
                              <tr key={row.item_id} className="text-xs hover:bg-slate-50/80">
                                <td className="px-3 py-2.5">
                                  <div className="flex items-center gap-2">
                                    <ItemThumb title={row.name_th} urls={row.image_urls} captions={row.image_captions} />
                                    <span>
                                      <span className="font-mono text-sm font-bold text-slate-900">{row.short_code}</span>
                                      <span className="block text-xs leading-tight text-slate-500">{row.name_th}</span>
                                    </span>
                                  </div>
                                </td>
                                <td className="px-3 py-2.5">
                                  <div className="flex flex-wrap gap-1">
                                    {locations.map((zone) => {
                                      const amount = row.by_location_count_qty[zone.location_code] ?? 0;
                                      const tone = amount < 0 ? "border border-red-200 bg-red-50 font-semibold text-red-700" : amount > 0 ? "border border-emerald-200 bg-emerald-50 font-semibold text-emerald-800" : "bg-slate-50 text-slate-400";
                                      return <span key={zone.location_code} title={zone.location_name_th} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs tabular-nums ${tone}`}>{zone.short_label} {formatFnbQty(amount, "", false)}</span>;
                                    })}
                                  </div>
                                </td>
                                <td className={`px-3 py-2.5 text-right text-sm font-semibold tabular-nums ${row.total_count_qty < 0 ? "text-red-600" : "text-slate-900"}`}>
                                  {formatFnbQty(row.total_count_qty, row.count_uom)}
                                  {row.open_pack_net_recipe_qty > 0 ? <span className="block text-[11px] font-normal text-slate-500">+ เปิดค้าง {formatFnbQty(row.open_pack_net_recipe_qty, row.recipe_uom)}</span> : null}
                                </td>
                                {props.showCost ? <td className="px-3 py-2.5 text-right tabular-nums text-slate-700">฿{(row.unit_cost_per_count_uom ?? 0).toFixed(2)}</td> : null}
                                {props.showCost ? <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-slate-900">฿{(row.total_stock_value_thb ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td> : null}
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  <span className={expiryTone(row.nearest_expiry_date)}>{formatShortDateTH(row.nearest_expiry_date)}</span>
                                  {row.active_lot_count > 1 ? <span className="block text-[11px] text-slate-400">({row.active_lot_count} ล็อต)</span> : null}
                                </td>
                                <td className="px-3 py-2.5 whitespace-nowrap">
                                  {row.last_counted_at ? (
                                    <>
                                      <span className="block text-xs font-medium whitespace-nowrap text-slate-700">{formatShortDateTH(row.last_counted_at)}</span>
                                      <span className="block text-[11px] whitespace-nowrap text-slate-400">{formatTimeHHMM(row.last_counted_at)} · {row.last_counted_by || "—"}</span>
                                    </>
                                  ) : "—"}
                                </td>
                                <td className="px-3 py-2.5 text-right"><MovementButton onClick={() => props.onOpen(row.item_id)} /></td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                  </div>
                );
              }) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}
