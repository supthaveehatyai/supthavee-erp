"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { signOut } from "@/lib/actions/auth.actions";
import { BranchMenuSales } from "@/app/liff/branch-menu-sales";
import { OperationsWorkspace } from "@/app/fnb/operations/operations-workspace";
import { InventoryWorkspace } from "@/app/fnb/inventory/inventory-workspace";
import { ExpiryPanel, ManualReceive } from "@/app/fnb/procurement/procurement-workspace";
import { listStoreCountItemsAction } from "@/lib/actions/fnb-inventory";
import { LiffShiftSession } from "@/components/fnb/shift-start-gate";
import type { FnbBranchOption, FnbBrandCode, FnbExpiryLotRow, FnbItemRow, FnbUnpackLine } from "@/types/fnb";

export function BrandStore({
  brand,
  title,
  branches,
  shelfItems,
  items,
  pendingLots,
  lots,
  schemaMessage,
  actorName,
  userId,
  branchLabel,
  initialBranch,
  showGoodsReceipt = true,
  showMenuSales = false,
}: {
  brand: FnbBrandCode;
  title: string;
  branches: FnbBranchOption[];
  shelfItems: FnbItemRow[];
  items: Pick<FnbItemRow, "id" | "short_code" | "name_th" | "default_purchase_uom" | "recipe_per_purchase_uom" | "shelf_life_months" | "requires_expiry_tracking" | "allow_decimal_count_qty" | "count_uom" | "is_catch_weight_produce" | "piece_uom_label" | "avg_gross_grams_per_piece" | "prep_yield_pct" | "default_date_stamp_mode" | "shelf_life_value" | "shelf_life_unit">[];
  pendingLots: FnbUnpackLine[];
  lots: FnbExpiryLotRow[];
  schemaMessage: string | null;
  actorName: string;
  userId: string;
  branchLabel: string;
  initialBranch: string;
  showGoodsReceipt?: boolean;
  showMenuSales?: boolean;
}) {
  const [tab, setTab] = useState<"ops" | "receive" | "lots" | "count" | "sales">("ops");
  return (
    <main className={`min-h-screen px-3 py-4 ${brand === "CHATORN" ? "fnb-chatorn bg-[#FDF2F4]" : "fnb-lucky bg-red-50"}`}>
      <LineBrowserTip />
      <header className="mb-3 space-y-3 rounded-2xl bg-white px-3 py-3 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-red-800">{brand === "LUCKY_CUP" ? "🔴 Lucky Cup" : "🟠 ชาทรตะโหมด"}</p>
            <p className="mt-1 text-sm text-slate-800">👤 พนักงาน: {actorName}</p>
            {branchLabel ? <p className="text-xs text-slate-500">{branchLabel}</p> : null}
          </div>
          <button type="button" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => { void signOut(); }}>ออกจากระบบ</button>
        </div>
      </header>
      <p className="sr-only">{title}</p>
      {schemaMessage ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{schemaMessage}</p> : null}
      <LiffShiftSession userId={userId} actorName={actorName} branches={branches} brand={brand} preferredBranch={initialBranch}>
        {(lock) => (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "ops" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("ops")}>ปฏิบัติการร้าน</button>
              {showGoodsReceipt ? <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "receive" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("receive")}>รับของเข้า</button> : null}
              {showGoodsReceipt ? <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "lots" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("lots")}>แกะล็อตหมดอายุ</button> : null}
              <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "count" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("count")}>นับสต็อก</button>
              {showMenuSales ? <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "sales" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("sales")}>ยอดขายรายเมนูสาขา</button> : null}
            </div>
            {tab === "ops" ? <OperationsWorkspace branches={branches} shelfItems={shelfItems} brandLock={brand} activeBrand={brand} superAdmin={false} actorName={actorName} actorSource="liff" initialBranch={lock.branchCode} lockedShift={lock.shiftSlot} /> : null}
            {tab === "receive" && showGoodsReceipt ? <ManualReceive branches={branches} items={items} brandLock={brand} revealCost={false} actorSource="liff" branchCode={lock.branchCode} /> : null}
            {tab === "lots" && showGoodsReceipt ? <ExpiryPanel pending={pendingLots} lots={lots} brandLock={brand} actorSource="liff" /> : null}
            {tab === "count" ? <LiffStockCount brand={brand} branches={branches} branchCode={lock.branchCode} actorName={actorName} /> : null}
            {tab === "sales" && showMenuSales ? <BranchMenuSales branches={branches} branchCode={lock.branchCode} /> : null}
          </>
        )}
      </LiffShiftSession>
    </main>
  );
}

function LiffStockCount(props: { brand: FnbBrandCode; branches: FnbBranchOption[]; branchCode: string; actorName: string }) {
  const [items, setItems] = useState<Awaited<ReturnType<typeof listStoreCountItemsAction>> extends { data: infer T } ? T : never>([]);
  useEffect(() => {
    void listStoreCountItemsAction(props.branchCode).then((loaded) => setItems(loaded.data));
  }, [props.branchCode]);
  const visible = props.branches.filter((item) => item.branch_code === props.branchCode);
  return <InventoryWorkspace brand={props.brand} branches={visible.length ? visible : props.branches} balances={[]} items={items} initialBranch={props.branchCode} actorName={props.actorName} blindCount />;
}

function LineBrowserTip() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    setVisible(navigator.userAgent.includes("Line/"));
  }, []);
  if (!visible) return null;
  return (
    <div className="mb-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-950 ring-1 ring-amber-200">
      <p className="flex-1">💡 แนะนำ: หากเปิดจากแชท LINE แล้วกล้องค้าง กดปุ่มมุมขวาล่างเลือก &quot;เปิดด้วยเบราว์เซอร์เริ่มต้น (Safari/Chrome)&quot;</p>
      <button
        type="button"
        className="shrink-0 rounded-lg bg-amber-900 px-2 py-1 text-xs font-semibold text-white"
        onClick={() => {
          const url = new URL(window.location.href);
          url.searchParams.set("openExternalBrowser", "1");
          void navigator.clipboard.writeText(url.toString()).then(() => toast.success("คัดลอกลิงก์เปิดนอก LINE แล้ว"));
        }}
      >
        คัดลอกลิงก์
      </button>
      <button type="button" className="shrink-0 text-xs font-semibold" onClick={() => setVisible(false)}>ปิด</button>
    </div>
  );
}
