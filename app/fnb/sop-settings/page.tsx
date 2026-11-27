import { Suspense } from "react";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { listFnbItemsAction } from "@/lib/actions/fnb-items";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { listSopTemplatesAction } from "@/lib/actions/fnb-sop";
import { fnbToneClass, resolveActiveBrand } from "@/lib/fnb/active-brand";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { SopSettingsWorkspace } from "@/app/fnb/sop-settings/sop-settings-workspace";

export const dynamic = "force-dynamic";

export default async function SopSettingsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireFnbModuleAccess("sop_shift_settings");
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, (await searchParams).brand);
  const [branches, templates, items] = await Promise.all([
    listFnbBranchOptionsAction(),
    listSopTemplatesAction(),
    listFnbItemsAction(),
  ]);
  return (
    <div className={`space-y-4 ${fnbToneClass(brand)}`}>
    <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
    <SopSettingsWorkspace
      branches={branches.data.filter((item) => item.brand_code === brand)}
      templates={templates.data.filter((item) => item.brand_scope === brand || item.brand_scope === "ALL")}
      items={items.data.items.filter((item) => item.brand_scope === brand).map((item) => ({ id: item.id, short_code: item.short_code, name_th: item.name_th }))}
      schemaMessage={branches.error || templates.error || items.error}
    />
    </div>
  );
}
