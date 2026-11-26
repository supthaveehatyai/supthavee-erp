import { listFnbBranchOptionsAction, listFrontBackItemsAction, listPendingShiftApprovalsAction } from "@/lib/actions/fnb-operations";
import { requireFnbDeskAccess } from "@/lib/holding/workspace-access";
import { OperationsWorkspace } from "@/app/fnb/operations/operations-workspace";

export const dynamic = "force-dynamic";

export default async function FnbOperationsPage() {
  const ctx = await requireFnbDeskAccess();
  const [branches, shelf, approvals] = await Promise.all([
    listFnbBranchOptionsAction(),
    listFrontBackItemsAction(),
    ctx.isSuperAdmin ? listPendingShiftApprovalsAction() : Promise.resolve({ data: [], error: null, schemaReady: true }),
  ]);
  const visible = ctx.isSuperAdmin
    ? branches.data
    : branches.data.filter((item) => ctx.allowedBranchCodes.includes(item.branch_code));
  return (
    <OperationsWorkspace
      branches={visible}
      shelfItems={shelf.data}
      brandLock={ctx.assignedBrandCode}
      superAdmin={ctx.isSuperAdmin}
      actorName={ctx.displayActorName}
      actorSource="desktop"
      initialApprovals={approvals.data}
    />
  );
}
