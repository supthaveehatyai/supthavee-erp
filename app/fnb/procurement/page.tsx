import { listExpiryWorkspaceAction, listProcurementQueueAction, listReceiveItemsAction } from "@/lib/actions/fnb-procurement";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { ProcurementWorkspace } from "@/app/fnb/procurement/procurement-workspace";

export const dynamic = "force-dynamic";

export default async function FnbProcurementPage() {
  await requireSuperAdmin();
  const [branches, queue, items, expiry] = await Promise.all([
    listFnbBranchOptionsAction(),
    listProcurementQueueAction(),
    listReceiveItemsAction(),
    listExpiryWorkspaceAction(),
  ]);
  return (
    <ProcurementWorkspace
      branches={branches.data}
      items={items.data}
      pending={expiry.data.pending}
      lots={expiry.data.lots}
      payouts={queue.data.payouts}
    />
  );
}
