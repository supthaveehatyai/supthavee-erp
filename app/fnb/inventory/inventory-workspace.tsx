"use client";

import { useCallback, useEffect, useRef, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { BranchPills, fnbBranchStorageKey, useStoredBranch } from "@/components/fnb/branch-pills";
import { FnbQtyInput } from "@/components/fnb/fnb-qty-input";
import { transferFnbStockAction } from "@/lib/actions/fnb-inventory";
import { listBranchZonesAction, saveZoneCountsAction } from "@/lib/actions/fnb-store-day";
import { branchForBrand } from "@/lib/fnb/brand-branch";
import { FNB_BRAND_THEME, FNB_STOCK_SHEET_GROUPS, type FnbBranchOption, type FnbBrandCode, type FnbStockBalanceRow, type FnbStorageZone } from "@/types/fnb";

const field = "h-10 w-full rounded-md border border-slate-200 px-3 text-sm";

type CountItem = {
  id: string;
  short_code: string;
  name_th: string;
  item_category: string;
  count_uom: string;
  allow_decimal_count_qty: boolean;
  recipe_per_count_uom: number;
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
  const [tab, setTab] = useState<"sheet" | "transfer">("sheet");
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
  const [openGrams, setOpenGrams] = useState<Record<string, string>>({});
  const [expiry, setExpiry] = useState<Record<string, string>>({});
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
  useEffect(() => {
    void listBranchZonesAction(branch).then((loaded) => {
      setZones(loaded.data);
      setLocation(loaded.data[0]?.locationCode ?? "");
    });
  }, [branch]);
  const workDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(new Date());
  return (
    <div className={`space-y-4 ${tone}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-slate-900">สต็อก {FNB_BRAND_THEME[brand].label}</h1>
        <Link href={`/fnb/sop-settings?brand=${brand}`} className="text-sm text-[var(--fnb-brand)]">ตั้งจุดจัดเก็บและความสะอาด</Link>
      </div>
      <div className="flex gap-2">
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "sheet" ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setTab("sheet")}>📋 ใบตรวจนับสต็อกกึ่งแบบฟอร์ม</button>
        <button type="button" className={`rounded-full px-3 py-1 text-sm ${tab === "transfer" ? "bg-[var(--fnb-brand)] text-white" : "bg-white"}`} onClick={() => setTab("transfer")}>🔄 โอนสินค้าระหว่างสาขา</button>
      </div>
      {message ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p> : null}
      <BranchPills branches={sameBrand} active={branch} onPick={pickBranch} />
      {tab === "sheet" ? (
        <section className="space-y-3">
          <select className={field} value={branch} disabled={sameBrand.length <= 1} onChange={(event) => pickBranch(event.target.value)}>
            {sameBrand.map((item) => <option key={item.branch_code} value={item.branch_code}>{item.branch_code} {item.branch_name_th}</option>)}
          </select>
          <div className="flex flex-wrap gap-2">
            {zones.map((zone, index) => (
              <button key={zone.locationCode} type="button" className={`rounded-full px-3 py-1 text-sm ${location === zone.locationCode ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-slate-200"}`} onClick={() => setLocation(zone.locationCode)}>{index + 1}. {zone.locationNameTh}</button>
            ))}
          </div>
          {FNB_STOCK_SHEET_GROUPS.map((group) => {
            const rows = items.filter((item) => item.item_category === group.key);
            if (rows.length === 0) return null;
            const open = openGroups[group.key] !== false && (openGroups[group.key] === true || group.key === "RAW_MATERIAL");
            return (
              <article key={group.key} className="rounded-xl border bg-white">
                <button type="button" className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold" onClick={() => setOpenGroups((current) => ({ ...current, [group.key]: !open }))}>{group.label}<span>{open ? "ซ่อน" : "เปิด"}</span></button>
                {open ? (
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="bg-[var(--fnb-tint)] text-left"><tr><th className="p-2">รหัส</th><th className="p-2">ชื่อรายการ</th>{blindCount ? null : <th className="p-2">ยอดระบบ</th>}<th className="p-2">จำนวนแพ็ค/หน่วยเต็ม</th>{group.key === "RAW_MATERIAL" ? <th className="p-2">น้ำหนักแพ็คที่เปิดค้าง (g)</th> : null}<th className="p-2">วันหมดอายุใกล้สุด</th></tr></thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr key={row.id} className="border-t">
                            <td className="p-2">{row.short_code}</td>
                            <td className="p-2">{row.name_th}</td>
                            {blindCount ? null : <td className="p-2">{((onHand.get(row.id) ?? 0) / (row.recipe_per_count_uom || 1)).toFixed(0)} {row.count_uom}</td>}
                            <td className="p-2"><FnbQtyInput value={packs[row.id] ?? ""} onChange={(value) => setPacks((current) => ({ ...current, [row.id]: value }))} unit={row.count_uom} allowDecimal={row.allow_decimal_count_qty} /></td>
                            {group.key === "RAW_MATERIAL" ? <td className="p-2"><FnbQtyInput value={openGrams[row.id] ?? ""} onChange={(value) => setOpenGrams((current) => ({ ...current, [row.id]: value }))} unit="g" allowDecimal /></td> : null}
                            <td className="p-2"><input className="h-10 w-36 rounded-md border px-2 text-sm" type="date" value={expiry[row.id] ?? ""} onChange={(event) => setExpiry((current) => ({ ...current, [row.id]: event.target.value }))} /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </article>
            );
          })}
          <button type="button" className="rounded-md bg-[var(--fnb-brand)] px-4 py-2 text-sm text-white" disabled={pending || !location} onClick={() => start(async () => {
            const lines = items.filter((item) => packs[item.id] !== undefined && packs[item.id] !== "").map((item) => ({
              itemId: item.id,
              locationCode: location,
              countedQty: item.allow_decimal_count_qty ? Number(packs[item.id]) : Math.trunc(Number(packs[item.id]) || 0),
              nearestExpiry: expiry[item.id] || null,
              openingQty: 0,
              replenishedQty: 0,
              posSoldQty: 0,
            }));
            const saved = await saveZoneCountsAction({ branchCode: branch, workDate, stage: "CYCLE_COUNT", actorSource: "desktop", brandLock: brand, lines });
            if (saved.error || !saved.data.ok) { toast.error(saved.error || "บันทึกใบนับไม่สำเร็จ"); setMessage(saved.error || "บันทึกใบนับไม่สำเร็จ"); }
            else { toast.success("บันทึกใบตรวจนับจุดจัดเก็บนี้แล้ว"); setMessage("บันทึกใบตรวจนับจุดจัดเก็บนี้แล้ว"); }
          })}>💾 บันทึกใบตรวจนับจุดจัดเก็บนี้</button>
        </section>
      ) : (
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
      )}
    </div>
  );
}
