"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { signOut } from "@/lib/actions/auth.actions";
import { BranchMenuSales } from "@/app/liff/branch-menu-sales";
import { OperationsWorkspace } from "@/app/fnb/operations/operations-workspace";
import { ExpiryPanel, ManualReceive } from "@/app/fnb/procurement/procurement-workspace";
import { BranchPills, fnbBranchStorageKey, useStoredBranch } from "@/components/fnb/branch-pills";
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
  initialBranch,
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
  initialBranch: string;
  showGoodsReceipt?: boolean;
  showMenuSales?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState<"ops" | "receive" | "lots" | "sales">("ops");
  const [branch, setBranch] = useState(initialBranch || branches[0]?.branch_code || "");
  const storageKey = fnbBranchStorageKey(brand, actorName);
  const pickBranch = useCallback((code: string) => {
    if (!branches.some((item) => item.branch_code === code)) return;
    setBranch(code);
    localStorage.setItem(storageKey, code);
    const params = new URLSearchParams(window.location.search);
    if (params.get("branch") === code) return;
    params.set("branch", code);
    router.replace(`${pathname}?${params.toString()}`);
  }, [branches, pathname, router, storageKey]);
  useStoredBranch(storageKey, branches, pickBranch);
  useEffect(() => {
    if (!initialBranch || !new URLSearchParams(window.location.search).get("branch")) return;
    if (branches.some((item) => item.branch_code === initialBranch)) setBranch(initialBranch);
  }, [branches, initialBranch]);
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
        <BranchPills branches={branches} active={branch} onPick={pickBranch} />
      </header>
      <p className="sr-only">{title}</p>
      {schemaMessage ? <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">{schemaMessage}</p> : null}
      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "ops" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("ops")}>ปฏิบัติการร้าน</button>
        {showGoodsReceipt ? <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "receive" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("receive")}>รับของเข้า</button> : null}
        {showGoodsReceipt ? <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "lots" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("lots")}>แกะล็อตหมดอายุ</button> : null}
        {showMenuSales ? <button type="button" className={`rounded-full px-3 py-1.5 text-sm ${tab === "sales" ? "bg-[var(--fnb-brand)] text-white" : "bg-white ring-1 ring-red-200"}`} onClick={() => setTab("sales")}>ยอดขายรายเมนูสาขา</button> : null}
      </div>
      {tab === "ops" ? <OperationsWorkspace branches={branches} shelfItems={shelfItems} brandLock={brand} activeBrand={brand} superAdmin={false} actorName={actorName} actorSource="liff" initialBranch={branch} /> : null}
      {tab === "receive" && showGoodsReceipt ? <ManualReceive branches={branches} items={items} brandLock={brand} revealCost={false} actorSource="liff" branchCode={branch} /> : null}
      {tab === "lots" && showGoodsReceipt ? <ExpiryPanel pending={pendingLots} lots={lots} brandLock={brand} actorSource="liff" /> : null}
      {tab === "sales" && showMenuSales ? <BranchMenuSales branches={branches} branchCode={branch} /> : null}
    </main>
  );
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
