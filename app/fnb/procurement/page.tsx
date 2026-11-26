import { listProcurementQueueAction, listReceiveItemsAction } from "@/lib/actions/fnb-procurement";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { ProcurementWorkspace } from "@/app/fnb/procurement/procurement-workspace";

export const dynamic = "force-dynamic";

export default async function FnbProcurementPage() {
  await requireSuperAdmin();
  const [branches, queue, items] = await Promise.all([
    listFnbBranchOptionsAction(),
    listProcurementQueueAction(),
    listReceiveItemsAction(),
  ]);
  return (
    <ProcurementWorkspace
      branches={branches.data}
      receipts={queue.data.receipts}
      payouts={queue.data.payouts}
      items={items.data}
      liff={false}
    />
  );
}
