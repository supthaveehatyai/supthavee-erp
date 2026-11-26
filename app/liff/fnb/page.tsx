import { listFnbBranchOptionsAction, listFrontBackItemsAction } from "@/lib/actions/fnb-operations";
import { OperationsWorkspace } from "@/app/fnb/operations/operations-workspace";

export const dynamic = "force-dynamic";

export default async function LiffFnbPage() {
  const [branches, shelf] = await Promise.all([listFnbBranchOptionsAction(), listFrontBackItemsAction()]);
  return (
    <main className="min-h-screen bg-red-50 px-3 py-4">
      <OperationsWorkspace branches={branches.data} shelfItems={shelf.data} liff schemaMessage={branches.error ?? shelf.error} />
    </main>
  );
}
