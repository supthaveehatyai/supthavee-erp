import { listFnbBranchOptionsAction, listFrontBackItemsAction } from "@/lib/actions/fnb-operations";
import { listExpiryWorkspaceAction, listReceiveItemsAction } from "@/lib/actions/fnb-procurement";
import { BrandStore } from "@/app/liff/brand-store";

export const dynamic = "force-dynamic";

export default async function ChatornLiffPage() {
  const [branches, shelf, items, expiry] = await Promise.all([
    listFnbBranchOptionsAction("CHATORN"),
    listFrontBackItemsAction("CHATORN"),
    listReceiveItemsAction("CHATORN"),
    listExpiryWorkspaceAction("CHATORN"),
  ]);
  return (
    <BrandStore
      brand="CHATORN"
      title="ชาทรตะโหมด"
      branches={branches.data}
      shelfItems={shelf.data}
      items={items.data}
      pendingLots={expiry.data.pending}
      lots={expiry.data.lots}
      schemaMessage={branches.error || shelf.error || items.error || expiry.error}
    />
  );
}
