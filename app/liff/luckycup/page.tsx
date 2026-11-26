import { listFnbBranchOptionsAction, listFrontBackItemsAction } from "@/lib/actions/fnb-operations";
import { listExpiryWorkspaceAction, listReceiveItemsAction } from "@/lib/actions/fnb-procurement";
import { BrandStore } from "@/app/liff/brand-store";

export const dynamic = "force-dynamic";

export default async function LuckyCupLiffPage() {
  const [branches, shelf, items, expiry] = await Promise.all([
    listFnbBranchOptionsAction("LUCKY_CUP"),
    listFrontBackItemsAction("LUCKY_CUP"),
    listReceiveItemsAction("LUCKY_CUP"),
    listExpiryWorkspaceAction("LUCKY_CUP"),
  ]);
  return (
    <BrandStore
      brand="LUCKY_CUP"
      title="Lucky Cup"
      branches={branches.data}
      shelfItems={shelf.data}
      items={items.data}
      pendingLots={expiry.data.pending}
      lots={expiry.data.lots}
      schemaMessage={branches.error || shelf.error || items.error || expiry.error}
    />
  );
}
