import { listExpiryWorkspaceAction, listProcurementQueueAction, listReceiveItemsAction } from "@/lib/actions/fnb-procurement";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { requireFnbProcurementOffice } from "@/lib/holding/workspace-access";
import { ProcurementWorkspace } from "@/app/fnb/procurement/procurement-workspace";

export const dynamic = "force-dynamic";

export default async function FnbProcurementPage() {
  const ctx = await requireFnbProcurementOffice();
  const [branches, queue, items, expiry] = await Promise.all([
    listFnbBranchOptionsAction(),
    listProcurementQueueAction(),
    listReceiveItemsAction(),
    listExpiryWorkspaceAction(),
  ]);
  const allowedBrands = ctx.isSuperAdmin
    ? null
    : new Set([ctx.assignedBrandCode, ...ctx.hrAllowedBrandCodes].filter((item): item is "LUCKY_CUP" | "CHATORN" => item === "LUCKY_CUP" || item === "CHATORN"));
  const visibleBranches = branches.data.filter((item) => !allowedBrands || allowedBrands.has(item.brand_code as "LUCKY_CUP" | "CHATORN")).filter((item) => ctx.isSuperAdmin || ctx.allowedBranchCodes.length === 0 || ctx.allowedBranchCodes.includes(item.branch_code));
  const branchCodes = new Set(visibleBranches.map((item) => item.branch_code));
  return (
    <ProcurementWorkspace
      branches={visibleBranches}
      items={items.data.filter((item) => !allowedBrands || item.brand_scope === "ALL" || allowedBrands.has(item.brand_scope as "LUCKY_CUP"))}
      pending={expiry.data.pending.filter((item) => branchCodes.has(item.branch_code))}
      lots={expiry.data.lots.filter((item) => branchCodes.has(item.branch_code))}
      payouts={queue.data.payouts.filter((item) => branchCodes.has(item.branch_code))}
      showGoods={ctx.isSuperAdmin || ctx.fnbModulePermissions.goods_receipt_expiry}
      showPayout={ctx.isSuperAdmin || ctx.fnbModulePermissions.hq_tax_reimburse}
      revealCost={ctx.isSuperAdmin || ctx.fnbGuardrailPermissions.can_view_cost_price}
    />
  );
}
