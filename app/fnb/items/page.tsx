import { Suspense } from "react";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { listFnbItemsAction } from "@/lib/actions/fnb-items";
import { fnbToneClass, resolveActiveBrand } from "@/lib/fnb/active-brand";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { ItemsWorkspace } from "@/app/fnb/items/items-workspace";

export const dynamic = "force-dynamic";

export default async function FnbItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; brand?: string }>;
}) {
  const ctx = await requireFnbModuleAccess("master_items_bom");
  const params = await searchParams;
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, params.brand);
  const listed = await listFnbItemsAction();
  const items = listed.data.items.filter((item) => item.brand_scope === brand);
  const itemIds = new Set(items.map((item) => item.id));
  return (
    <div className={`space-y-4 ${fnbToneClass(brand)}`}>
      <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
      <ItemsWorkspace items={items} packs={listed.data.packs.filter((pack) => itemIds.has(pack.item_id))} initialTab={params.tab ?? ""} brand={brand} />
    </div>
  );
}
