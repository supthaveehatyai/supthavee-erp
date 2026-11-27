import { listFnbItemsAction } from "@/lib/actions/fnb-items";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { ItemsWorkspace } from "@/app/fnb/items/items-workspace";

export const dynamic = "force-dynamic";

export default async function FnbItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requireFnbModuleAccess("master_items_bom");
  const params = await searchParams;
  const listed = await listFnbItemsAction();
  const brands = ctx.isSuperAdmin ? null : new Set([ctx.assignedBrandCode, ...ctx.hrAllowedBrandCodes].filter((item): item is "LUCKY_CUP" | "CHATORN" => item === "LUCKY_CUP" || item === "CHATORN"));
  const items = listed.data.items.filter((item) => !brands || brands.size === 0 || item.brand_scope === "ALL" || brands.has(item.brand_scope as "LUCKY_CUP"));
  const itemIds = new Set(items.map((item) => item.id));
  return <ItemsWorkspace items={items} packs={listed.data.packs.filter((pack) => itemIds.has(pack.item_id))} initialTab={params.tab ?? ""} />;
}
