import { Suspense } from "react";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { listBrandCountItemsAction, listFnbStockAction } from "@/lib/actions/fnb-inventory";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { fnbToneClass, resolveActiveBrand } from "@/lib/fnb/active-brand";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { InventoryWorkspace } from "@/app/fnb/inventory/inventory-workspace";

export const dynamic = "force-dynamic";

export default async function FnbInventoryPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireFnbModuleAccess("branch_inventory_transfer");
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, (await searchParams).brand);
  const [branches, stock, items] = await Promise.all([listFnbBranchOptionsAction(), listFnbStockAction(), listBrandCountItemsAction(brand)]);
  const visible = branches.data.filter((item) => item.brand_code === brand && (ctx.isSuperAdmin || ctx.allowedBranchCodes.length === 0 || ctx.allowedBranchCodes.includes(item.branch_code)));
  return (
    <div className={fnbToneClass(brand)}>
      <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
      <InventoryWorkspace
        brand={brand}
        branches={visible}
        balances={stock.data.filter((row) => visible.some((branch) => branch.branch_code === row.branch_code))}
        items={items.data}
        blindCount={!ctx.isSuperAdmin && ctx.fnbGuardrailPermissions.enforce_blind_count}
        showCost={ctx.isSuperAdmin || ctx.fnbGuardrailPermissions.can_view_cost_price}
      />
    </div>
  );
}
