import { listFnbStockAction } from "@/lib/actions/fnb-inventory";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { InventoryWorkspace } from "@/app/fnb/inventory/inventory-workspace";

export const dynamic = "force-dynamic";

export default async function FnbInventoryPage() {
  const ctx = await requireFnbModuleAccess("branch_inventory_transfer");
  const [branches, stock] = await Promise.all([listFnbBranchOptionsAction(), listFnbStockAction()]);
  const visible = ctx.isSuperAdmin || ctx.allowedBranchCodes.length === 0
    ? branches.data
    : branches.data.filter((item) => ctx.allowedBranchCodes.includes(item.branch_code));
  const brandLimited = ctx.isSuperAdmin
    ? visible
    : visible.filter((item) => {
        const brands = new Set<string>([ctx.assignedBrandCode, ...ctx.hrAllowedBrandCodes].filter((code): code is "LUCKY_CUP" | "CHATORN" => code === "LUCKY_CUP" || code === "CHATORN"));
        return brands.size === 0 || brands.has(item.brand_code);
      });
  return (
    <InventoryWorkspace
      branches={brandLimited}
      balances={stock.data}
      blindCount={!ctx.isSuperAdmin && ctx.fnbGuardrailPermissions.enforce_blind_count}
      showCost={ctx.isSuperAdmin || ctx.fnbGuardrailPermissions.can_view_cost_price}
    />
  );
}
