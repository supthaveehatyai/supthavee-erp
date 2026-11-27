import { listFnbMenusAction } from "@/lib/actions/fnb-menus";
import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { MenusWorkspace } from "@/app/fnb/menus/menus-workspace";

export const dynamic = "force-dynamic";

export default async function FnbMenusPage() {
  const ctx = await requireFnbModuleAccess("master_items_bom");
  const listed = await listFnbMenusAction();
  const brands = ctx.isSuperAdmin ? null : new Set([ctx.assignedBrandCode, ...ctx.hrAllowedBrandCodes].filter((item): item is "LUCKY_CUP" | "CHATORN" => item === "LUCKY_CUP" || item === "CHATORN"));
  const menus = listed.data.menus.filter((item) => !brands || brands.size === 0 || brands.has(item.brand_code as "LUCKY_CUP"));
  const menuIds = new Set(menus.map((item) => item.id));
  const bases = listed.data.bases.filter((item) => !brands || brands.size === 0 || brands.has(item.brand_code as "LUCKY_CUP"));
  return <MenusWorkspace bases={bases} menus={menus} lines={listed.data.lines.filter((line) => menuIds.has(line.menu_id))} />;
}
