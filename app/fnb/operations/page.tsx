import { Suspense } from "react";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { listFnbBranchOptionsAction, listFrontBackItemsAction, listPendingShiftApprovalsAction } from "@/lib/actions/fnb-operations";
import { resolveActiveBrand, fnbToneClass } from "@/lib/fnb/active-brand";
import { requireFnbDeskAccess } from "@/lib/holding/workspace-access";
import { OperationsWorkspace } from "@/app/fnb/operations/operations-workspace";

export const dynamic = "force-dynamic";

export default async function FnbOperationsPage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireFnbDeskAccess();
  const params = await searchParams;
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, params.brand);
  const [branches, shelf, approvals] = await Promise.all([
    listFnbBranchOptionsAction(),
    listFrontBackItemsAction(brand),
    ctx.isSuperAdmin ? listPendingShiftApprovalsAction() : Promise.resolve({ data: [], error: null, schemaReady: true }),
  ]);
  const visible = branches.data.filter((item) => item.brand_code === brand && (ctx.isSuperAdmin || ctx.allowedBranchCodes.includes(item.branch_code)));
  return (
    <div className={`space-y-4 ${fnbToneClass(brand)}`}>
      <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
      <OperationsWorkspace
        branches={visible}
        shelfItems={shelf.data.filter((item) => item.brand_scope === brand)}
        brandLock={null}
        superAdmin={ctx.isSuperAdmin}
        actorName={ctx.displayActorName}
        actorSource="desktop"
        initialApprovals={approvals.data}
        activeBrand={brand}
      />
    </div>
  );
}
