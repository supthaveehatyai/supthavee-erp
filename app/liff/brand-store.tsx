"use client";

import { useState } from "react";
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
}: {
  brand: FnbBrandCode;
  title: string;
  branches: FnbBranchOption[];
  shelfItems: FnbItemRow[];
  items: Pick<FnbItemRow, "id" | "short_code" | "name_th" | "default_purchase_uom" | "recipe_per_purchase_uom" | "shelf_life_months" | "requires_expiry_tracking">[];
  pendingLots: FnbUnpackLine[];
  lots: FnbExpiryLotRow[];
  schemaMessage: string | null;
  actorName: string;
}) {
  const [tab, setTab] = useState<"ops" | "receive" | "lots">("ops");
  return (
    <main className="min-h-screen bg-red-50 px-3 py-4">
      <p className="text-xs font-semibold text-red-700">{title}</p>
      {schemaMessage ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{schemaMessage}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "ops" ? "bg-red-700 text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("ops")}>ปฏิบัติการร้าน</button>
        <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "receive" ? "bg-red-700 text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("receive")}>รับของเข้า</button>
        <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "lots" ? "bg-red-700 text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("lots")}>แกะล็อตหมดอายุ</button>
      </div>
      {tab === "ops" ? <OperationsWorkspace branches={branches} shelfItems={shelfItems} brandLock={brand} superAdmin={false} actorName={actorName} actorSource="liff" /> : null}
      {tab === "receive" ? <ManualReceive branches={branches} items={items} brandLock={brand} revealCost={false} actorSource="liff" /> : null}
      {tab === "lots" ? <ExpiryPanel pending={pendingLots} lots={lots} brandLock={brand} actorSource="liff" /> : null}
    </main>
  );
}
