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
import { FnbStockCardSheet } from "@/components/fnb/fnb-stock-card-sheet";
import { getExecutiveInventoryOverviewAction, saveSingleInventoryItemCountAction, transferFnbStockAction } from "@/lib/actions/fnb-inventory";
import { listBranchZonesAction } from "@/lib/actions/fnb-store-day";
import { branchForBrand } from "@/lib/fnb/brand-branch";
import { hidesOpenPackWeight, openPackNetQty } from "@/lib/utils/fnb-expiry";
import { FNB_BRAND_THEME, FNB_STOCK_SHEET_GROUPS, type FnbBranchOption, type FnbBrandCode, type FnbExecutiveInventory, type FnbStockBalanceRow, type FnbStorageZone } from "@/types/fnb";

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
  const [overviewFilter, setOverviewFilter] = useState<"all" | "low" | "fefo">("all");
  const [category, setCategory] = useState("ALL");
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
  return (
    <div className={`space-y-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">สต็อก {FNB_BRAND_THEME[brand].label}</h1>
        <Link href={`/fnb/sop-settings?brand=${brand}`} className="text-sm text-[var(--fnb-brand)]">ตั้งจุดจัดเก็บและความสะอาด</Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "work" ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setTab("work")}>คลังสาขานี้</button>
          <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "transfer" ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setTab("transfer")}>🔄 โอนสินค้าระหว่างสาขา (เฉพาะแบรนด์เดียวกัน)</button>
        </div>
        {tab === "work" ? (
          <div className="flex flex-wrap gap-2">
            <button type="button" className={`rounded-full px-3 py-1 text-sm ${lens === "executive" ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setLens("executive")}>👔 มุมมองผู้บริหาร (ตารางสรุปสต็อก)</button>
            <button type="button" className={`rounded-full px-3 py-1 text-sm ${lens === "count" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setLens("count")}>✍️ โหมดคีย์ตรวจนับสต็อกหน้างาน</button>
          </div>
        ) : null}
      </div>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <BranchPills branches={sameBrand} active={branch} onPick={pickBranch} />
      <FnbStockCardSheet open={sheetOpen} onOpenChange={setSheetOpen} branch={branch} itemId={cardItem} category={items.find((item) => item.id === cardItem)?.item_category || overview?.items.find((item) => item.item_id === cardItem)?.item_category || ""} zones={zones} />
      {tab === "work" && lens === "executive" ? <ExecutiveOverview overview={overview} showCost={showCost} filter={overviewFilter} setFilter={setOverviewFilter} category={category} setCategory={setCategory} onOpen={(itemId) => { setCardItem(itemId); setSheetOpen(true); }} /> : null}
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
                <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => { setCardItem(focusItem.id); setSheetOpen(true); }}>📜 ความเคลื่อนไหว</button>
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
                            <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => { setCardItem(row.id); setSheetOpen(true); }}>📜 ความเคลื่อนไหว</button>
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

function ExecutiveOverview(props: {
  overview: FnbExecutiveInventory | null;
  showCost: boolean;
  filter: "all" | "low" | "fefo";
  setFilter: (value: "all" | "low" | "fefo") => void;
  category: string;
  setCategory: (value: string) => void;
  onOpen: (itemId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const locations = props.overview?.locations ?? [];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 14);
  const horizonIso = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(horizon);
  const rows = props.overview?.items ?? [];
  const lowRows = rows.filter((row) => row.total_count_qty < 0 || (row.reorder_point_count_qty > 0 && row.total_count_qty < row.reorder_point_count_qty));
  const fefoRows = rows.filter((row) => row.nearest_expiry_date && row.nearest_expiry_date <= horizonIso);
  const stocked = rows.filter((row) => row.total_count_qty > 0).length;
  const visible = rows.filter((row) => {
    if (props.category !== "ALL" && row.item_category !== props.category) return false;
    if (props.filter === "low" && !lowRows.some((item) => item.item_id === row.item_id)) return false;
    if (props.filter === "fefo" && !fefoRows.some((item) => item.item_id === row.item_id)) return false;
    const needle = query.trim().toLowerCase();
    return !needle || `${row.short_code} ${row.name_th}`.toLowerCase().includes(needle);
  });
  return (
    <section className="space-y-3">
      <div className="grid gap-2 md:grid-cols-4">
        {props.showCost ? <article className="rounded-xl border bg-white p-3"><p className="text-xs text-slate-500">💰 มูลค่าสต็อกรวมสาขานี้ (ก่อน VAT)</p><p className="text-xl font-bold">฿{(props.overview?.stock_value_thb ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p></article> : null}
        <button type="button" className={`rounded-xl border p-3 text-left ${props.filter === "low" ? "border-red-400 bg-red-50" : "bg-white"}`} onClick={() => props.setFilter(props.filter === "low" ? "all" : "low")}><p className="text-xs text-slate-500">🔴 ต่ำกว่าจุดเตือนขั้นต่ำ / ติดลบ</p><p className="text-xl font-bold">{lowRows.length} รายการ</p></button>
        <button type="button" className={`rounded-xl border p-3 text-left ${props.filter === "fefo" ? "border-amber-400 bg-amber-50" : "bg-white"}`} onClick={() => props.setFilter(props.filter === "fefo" ? "all" : "fefo")}><p className="text-xs text-slate-500">🟠 ล็อตใกล้หมดอายุใน 14 วัน (FEFO)</p><p className="text-xl font-bold">{fefoRows.length} รายการ</p></button>
        <article className="rounded-xl border bg-white p-3"><p className="text-xs text-slate-500">📦 จำนวนรายการที่มีของคงเหลือ</p><p className="text-xl font-bold">{stocked} / {rows.length} รายการ</p></article>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${props.category === "ALL" ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => props.setCategory("ALL")}>ทั้งหมด</button>
        {FNB_STOCK_SHEET_GROUPS.map((group) => (
          <button key={group.key} type="button" className={`rounded-full px-3 py-1 text-sm ${props.category === group.key ? "bg-slate-900 text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => props.setCategory(group.key)}>{group.label}</button>
        ))}
        <input className="h-10 w-56 rounded-md border px-3 text-sm" value={query} placeholder="ค้นหารหัสหรือชื่อ" onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="rounded-md border px-3 py-2 text-sm" onClick={() => {
          const sheet = XLSX.utils.json_to_sheet(visible.map((row) => ({
            รหัส: row.short_code,
            ชื่อ: row.name_th,
            คงเหลือ: row.total_count_qty,
            หน่วย: row.count_uom,
            เปิดค้าง: row.open_pack_net_recipe_qty,
            มูลค่า: props.showCost ? row.total_stock_value_thb ?? "" : "",
            หมดอายุใกล้สุด: row.nearest_expiry_date,
            นับล่าสุด: row.last_counted_at,
            ผู้บันทึก: row.last_counted_by,
          })));
          const book = XLSX.utils.book_new();
          XLSX.utils.book_append_sheet(book, sheet, "Stock");
          XLSX.writeFile(book, `fnb-stock-${props.overview?.branch_code || "branch"}.xlsx`);
        }}>📥 ดาวน์โหลดตารางสต็อกคงเหลือ (.xlsx)</button>
      </div>
      <div className="overflow-auto rounded-xl border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-2">รหัส & ชื่อ</th><th>แยกตามจุดจัดเก็บ</th><th>คงเหลือรวมสุทธิ</th>{props.showCost ? <th>มูลค่าทุนรวม (฿)</th> : null}<th>วันหมดอายุใกล้สุด</th><th>นับล่าสุด</th><th /></tr></thead>
          <tbody>
            {visible.map((row, index) => {
              const low = row.total_count_qty < 0 || (row.reorder_point_count_qty > 0 && row.total_count_qty < row.reorder_point_count_qty);
              const near = row.nearest_expiry_date && row.nearest_expiry_date <= horizonIso;
              const counted = row.last_counted_at ? `${new Intl.DateTimeFormat("th-TH", { timeZone: "Asia/Bangkok", dateStyle: "short", timeStyle: "short" }).format(new Date(row.last_counted_at))} · ${row.last_counted_by}` : "-";
              return (
                <tr key={row.item_id} className={`border-t ${index % 2 === 0 ? "bg-white" : "bg-slate-50"}`}>
                  <td className="p-2">
                    <div className="flex items-center gap-2">
                      <ItemSlideShowPreview title={row.name_th} urls={row.image_urls} captions={row.image_captions} />
                      <span><strong>{row.short_code}</strong> {row.name_th}</span>
                    </div>
                  </td>
                  <td className="text-xs">{locations.map((zone) => `${zone.location_name_th}: ${row.by_location_count_qty[zone.location_code] ?? 0}`).join(" · ") || "-"}</td>
                  <td className="font-semibold">{low ? <span className="rounded bg-red-100 px-1 text-red-800">{row.total_count_qty} {row.count_uom}</span> : <span>{row.total_count_qty} {row.count_uom}</span>}{row.open_pack_net_recipe_qty > 0 ? <span className="mt-1 block text-xs font-normal text-slate-500">+ เปิดค้าง {row.open_pack_net_recipe_qty} {row.recipe_uom}</span> : null}</td>
                  {props.showCost ? <td>{(row.total_stock_value_thb ?? 0).toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td> : null}
                  <td>{row.nearest_expiry_date ? <span className={`rounded px-1 ${near || row.nearest_expiry_date < today ? "bg-amber-100 text-amber-900" : "bg-slate-100"}`} title={`${row.expiry_lots.length} ล็อต`}>{row.nearest_expiry_date}</span> : "-"}</td>
                  <td className="text-xs">{counted}</td>
                  <td><button type="button" className="rounded-md border px-2 py-1 text-xs" onClick={() => props.onOpen(row.item_id)}>📜 ความเคลื่อนไหว</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
