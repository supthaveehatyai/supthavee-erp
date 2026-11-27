import { Suspense } from "react";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { listExpiryWorkspaceAction, listProcurementQueueAction, listReceiveItemsAction } from "@/lib/actions/fnb-procurement";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { fnbToneClass, resolveActiveBrand } from "@/lib/fnb/active-brand";
import { requireFnbProcurementOffice } from "@/lib/holding/workspace-access";
import { ProcurementWorkspace } from "@/app/fnb/procurement/procurement-workspace";

export const dynamic = "force-dynamic";

export default async function FnbProcurementPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireFnbProcurementOffice();
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, (await searchParams).brand);
  const [branches, queue, items, expiry] = await Promise.all([
    listFnbBranchOptionsAction(),
    listProcurementQueueAction(),
    listReceiveItemsAction(brand),
    listExpiryWorkspaceAction(brand),
  ]);
  const visibleBranches = branches.data.filter((item) => item.brand_code === brand && (ctx.isSuperAdmin || ctx.allowedBranchCodes.length === 0 || ctx.allowedBranchCodes.includes(item.branch_code)));
  const branchCodes = new Set(visibleBranches.map((item) => item.branch_code));
  return (
    <div className={`space-y-4 ${fnbToneClass(brand)}`}>
    <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
    <ProcurementWorkspace
      branches={visibleBranches}
      items={items.data.filter((item) => item.brand_scope === brand)}
      pending={expiry.data.pending.filter((item) => branchCodes.has(item.branch_code))}
      lots={expiry.data.lots.filter((item) => branchCodes.has(item.branch_code))}
      payouts={queue.data.payouts.filter((item) => branchCodes.has(item.branch_code))}
      showGoods={ctx.isSuperAdmin || ctx.fnbModulePermissions.goods_receipt_expiry}
      showPayout={ctx.isSuperAdmin || ctx.fnbModulePermissions.hq_tax_reimburse}
      revealCost={ctx.isSuperAdmin || ctx.fnbGuardrailPermissions.can_view_cost_price}
      brand={brand}
    />
    </div>
  );
}
