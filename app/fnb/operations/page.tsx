import { listFnbBranchOptionsAction, listFrontBackItemsAction } from "@/lib/actions/fnb-operations";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { OperationsWorkspace } from "@/app/fnb/operations/operations-workspace";

export const dynamic = "force-dynamic";

export default async function FnbOperationsPage() {
  await requireSuperAdmin();
  const [branches, shelf] = await Promise.all([listFnbBranchOptionsAction(), listFrontBackItemsAction()]);
  return (
    <OperationsWorkspace
      branches={branches.data}
      shelfItems={shelf.data}
      liff={false}
      schemaMessage={branches.error ?? shelf.error}
    />
  );
}
