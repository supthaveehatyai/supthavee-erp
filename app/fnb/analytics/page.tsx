import { Suspense } from "react";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { fnbToneClass, resolveActiveBrand } from "@/lib/fnb/active-brand";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { AnalyticsWorkspace } from "@/app/fnb/analytics/analytics-workspace";

export const dynamic = "force-dynamic";

export default async function FnbAnalyticsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireFnbModuleAccess("all_branch_analytics");
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, (await searchParams).brand);
  return (
    <div className={`space-y-4 ${fnbToneClass(brand)}`}>
      <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
      <AnalyticsWorkspace brand={brand} />
    </div>
  );
}
