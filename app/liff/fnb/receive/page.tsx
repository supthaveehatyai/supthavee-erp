import { listReceiveItemsAction } from "@/lib/actions/fnb-procurement";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { ProcurementWorkspace } from "@/app/fnb/procurement/procurement-workspace";

export const dynamic = "force-dynamic";

export default async function LiffReceivePage() {
  const [branches, items] = await Promise.all([listFnbBranchOptionsAction(), listReceiveItemsAction()]);
  return (
    <main className="min-h-screen bg-red-50 px-3 py-4">
      <ProcurementWorkspace branches={branches.data} receipts={[]} payouts={[]} items={items.data} liff />
    </main>
  );
}
