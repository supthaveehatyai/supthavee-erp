import { listFnbItemsAction } from "@/lib/actions/fnb-items";
import { requireFnbExecutiveAccess } from "@/lib/holding/workspace-access";
import { ItemsWorkspace } from "@/app/fnb/items/items-workspace";

export const dynamic = "force-dynamic";

export default async function FnbItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireFnbExecutiveAccess();
  const params = await searchParams;
  const listed = await listFnbItemsAction();
  return <ItemsWorkspace items={listed.data.items} packs={listed.data.packs} initialTab={params.tab ?? ""} />;
}
