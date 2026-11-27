"use client";

import { useState } from "react";
import { signOut } from "@/lib/actions/auth.actions";
import { BranchMenuSales } from "@/app/liff/branch-menu-sales";
import { OperationsWorkspace } from "@/app/fnb/operations/operations-workspace";
import { ExpiryPanel, ManualReceive } from "@/app/fnb/procurement/procurement-workspace";
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
  branchLabel,
  showGoodsReceipt = true,
  showMenuSales = false,
}: {
  brand: FnbBrandCode;
  title: string;
  branches: FnbBranchOption[];
  shelfItems: FnbItemRow[];
  items: Pick<FnbItemRow, "id" | "short_code" | "name_th" | "default_purchase_uom" | "recipe_per_purchase_uom" | "shelf_life_months" | "requires_expiry_tracking" | "allow_decimal_count_qty" | "count_uom">[];
  pendingLots: FnbUnpackLine[];
  lots: FnbExpiryLotRow[];
  schemaMessage: string | null;
  actorName: string;
  branchLabel: string;
  showGoodsReceipt?: boolean;
  showMenuSales?: boolean;
}) {
  const [tab, setTab] = useState<"ops" | "receive" | "lots" | "sales">("ops");
  return (
    <main className={`min-h-screen px-3 py-4 ${brand === "CHATORN" ? "fnb-chatorn bg-[#FDF2F4]" : "fnb-lucky bg-red-50"}`}>
      <header className="mb-3 flex items-start justify-between gap-3 rounded-2xl bg-white px-3 py-3 shadow-sm">
        <div>
          <p className="text-sm font-semibold text-red-800">{brand === "LUCKY_CUP" ? "🔴 Lucky Cup" : "🟠 ชาทรตะโหมด"}</p>
          <p className="mt-1 text-sm text-slate-800">👤 พนักงาน: {actorName}</p>
          {branchLabel ? <p className="text-xs text-slate-500">{branchLabel}</p> : null}
        </div>
        <button type="button" className="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white" onClick={() => { void signOut(); }}>ออกจากระบบ</button>
      </header>
      <p className="sr-only">{title}</p>
      {schemaMessage ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{schemaMessage}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "ops" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("ops")}>ปฏิบัติการร้าน</button>
        {showGoodsReceipt ? <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "receive" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("receive")}>รับของเข้า</button> : null}
        {showGoodsReceipt ? <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "lots" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("lots")}>แกะล็อตหมดอายุ</button> : null}
        {showMenuSales ? <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "sales" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("sales")}>ยอดขายรายเมนูสาขา</button> : null}
      </div>
      {tab === "ops" ? <OperationsWorkspace branches={branches} shelfItems={shelfItems} brandLock={brand} superAdmin={false} actorName={actorName} actorSource="liff" /> : null}
      {tab === "receive" && showGoodsReceipt ? <ManualReceive branches={branches} items={items} brandLock={brand} revealCost={false} actorSource="liff" /> : null}
      {tab === "lots" && showGoodsReceipt ? <ExpiryPanel pending={pendingLots} lots={lots} brandLock={brand} actorSource="liff" /> : null}
      {tab === "sales" && showMenuSales ? <BranchMenuSales branches={branches} /> : null}
    </main>
  );
}
