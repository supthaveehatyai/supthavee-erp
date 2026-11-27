import { Suspense } from "react";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { listFnbMenusAction } from "@/lib/actions/fnb-menus";
import { fnbToneClass, resolveActiveBrand } from "@/lib/fnb/active-brand";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { MenusWorkspace } from "@/app/fnb/menus/menus-workspace";

export const dynamic = "force-dynamic";

export default async function FnbMenusPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireFnbModuleAccess("master_items_bom");
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, (await searchParams).brand);
  const listed = await listFnbMenusAction();
  const menus = listed.data.menus.filter((item) => item.brand_code === brand);
  const menuIds = new Set(menus.map((item) => item.id));
  const bases = listed.data.bases.filter((item) => item.brand_code === brand);
  return (
    <div className={`space-y-4 ${fnbToneClass(brand)}`}>
      <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
      <MenusWorkspace bases={bases} menus={menus} lines={listed.data.lines.filter((line) => menuIds.has(line.menu_id))} brand={brand} isSuperAdmin={ctx.isSuperAdmin} />
    </div>
  );
}
