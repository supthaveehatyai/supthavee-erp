import { listFnbItemsAction } from "@/lib/actions/fnb-items";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { ItemsWorkspace } from "@/app/fnb/items/items-workspace";

export const dynamic = "force-dynamic";

export default async function FnbItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const listed = await listFnbItemsAction();
  return <ItemsWorkspace items={listed.data.items} packs={listed.data.packs} initialTab={params.tab ?? ""} />;
}
