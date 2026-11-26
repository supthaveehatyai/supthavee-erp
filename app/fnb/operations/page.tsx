import { listFnbBranchOptionsAction, listFrontBackItemsAction, listPendingShiftApprovalsAction } from "@/lib/actions/fnb-operations";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { OperationsWorkspace } from "@/app/fnb/operations/operations-workspace";

export const dynamic = "force-dynamic";

export default async function FnbOperationsPage() {
  await requireSuperAdmin();
  const [branches, shelf, approvals] = await Promise.all([
    listFnbBranchOptionsAction(),
    listFrontBackItemsAction(),
    listPendingShiftApprovalsAction(),
  ]);
  return (
    <OperationsWorkspace
      branches={branches.data}
      shelfItems={shelf.data}
      brandLock={null}
      superAdmin
      initialApprovals={approvals.data}
    />
  );
}
