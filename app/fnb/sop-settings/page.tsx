import { Suspense } from "react";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { listFnbItemsAction } from "@/lib/actions/fnb-items";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { fnbToneClass, resolveActiveBrand } from "@/lib/fnb/active-brand";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { SopSettingsWorkspace } from "@/app/fnb/sop-settings/sop-settings-workspace";

export const dynamic = "force-dynamic";

export default async function SopSettingsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireFnbModuleAccess("sop_shift_settings");
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, (await searchParams).brand);
  const [branches, items] = await Promise.all([
    listFnbBranchOptionsAction(),
    listFnbItemsAction(),
  ]);
  return (
    <div className={`space-y-4 ${fnbToneClass(brand)}`}>
    <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
    <SopSettingsWorkspace
      branches={branches.data.filter((item) => item.brand_code === brand)}
      items={items.data.items.filter((item) => item.is_active && (item.brand_scope === brand || item.brand_scope === "ALL")).map((item) => ({
        id: item.id,
        short_code: item.short_code,
        name_th: item.name_th,
        item_category: item.item_category,
        count_uom: item.count_uom,
        allow_decimal_count_qty: item.allow_decimal_count_qty,
        display_shelf_life_days: item.display_shelf_life_days,
      }))}
      schemaMessage={branches.error || items.error}
      brand={brand}
    />
    </div>
  );
}
