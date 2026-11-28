import { Suspense } from "react";
import { AuditWorkspace } from "@/app/fnb/audit/audit-workspace";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { fnbToneClass, resolveActiveBrand } from "@/lib/fnb/active-brand";
import { requireAnyFnbModule } from "@/lib/holding/workspace-access";

export const dynamic = "force-dynamic";

export default async function FnbAuditPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireAnyFnbModule(["all_branch_analytics", "tax_accounting_reports"]);
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, (await searchParams).brand);
  const branches = await listFnbBranchOptionsAction();
  const visible = branches.data.filter((item) => item.brand_code === brand && (ctx.isSuperAdmin || ctx.allowedBranchCodes.includes(item.branch_code)));
  return (
    <div className={`space-y-4 ${fnbToneClass(brand)}`}>
      <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
      <AuditWorkspace brand={brand} branches={visible} />
    </div>
  );
}
