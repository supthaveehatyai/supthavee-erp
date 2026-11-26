import { listFnbMenusAction } from "@/lib/actions/fnb-menus";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { MenusWorkspace } from "@/app/fnb/menus/menus-workspace";

export const dynamic = "force-dynamic";

export default async function FnbMenusPage() {
  await requireSuperAdmin();
  const listed = await listFnbMenusAction();
  return <MenusWorkspace bases={listed.data.bases} menus={listed.data.menus} lines={listed.data.lines} />;
}
