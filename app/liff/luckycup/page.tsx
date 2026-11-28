import { redirect } from "next/navigation";
import { listFnbBranchOptionsAction, listFrontBackItemsAction } from "@/lib/actions/fnb-operations";
import { listExpiryWorkspaceAction, listReceiveItemsAction } from "@/lib/actions/fnb-procurement";
import { listedBranch } from "@/lib/fnb/brand-branch";
import { requireWorkspacePageAccess } from "@/lib/holding/workspace-access";
import { BrandStore } from "@/app/liff/brand-store";

export const dynamic = "force-dynamic";

export default async function LuckyCupLiffPage({ searchParams }: { searchParams: Promise<{ branch?: string }> }) {
  const params = await searchParams;
  const requestedBranch = params.branch;
  const ctx = await requireWorkspacePageAccess("fnb");
  if (!ctx.isSuperAdmin && ctx.assignedBrandCode !== "LUCKY_CUP") {
    redirect(ctx.assignedBrandCode === "CHATORN" ? "/liff/chatorn" : "/forbidden");
  }
  const [branches, shelf, items, expiry] = await Promise.all([
    listFnbBranchOptionsAction("LUCKY_CUP"),
    listFrontBackItemsAction("LUCKY_CUP"),
    listReceiveItemsAction("LUCKY_CUP"),
    listExpiryWorkspaceAction("LUCKY_CUP"),
  ]);
  const visible = ctx.isSuperAdmin
    ? branches.data
    : branches.data.filter((item) => ctx.allowedBranchCodes.includes(item.branch_code));
  const branchLabel = visible.length === 1
    ? `สาขา ${visible[0]?.branch_code}`
    : visible.map((item) => item.branch_code).join(" · ");
  return (
    <BrandStore
      brand="LUCKY_CUP"
      title="Lucky Cup"
      branches={visible}
      shelfItems={shelf.data}
      items={items.data}
      pendingLots={expiry.data.pending}
      lots={expiry.data.lots}
      schemaMessage={visible.length === 0 ? "บัญชียังไม่ถูกกำหนดสาขา" : branches.error || shelf.error || items.error || expiry.error}
      actorName={ctx.displayActorName}
      branchLabel={branchLabel}
      initialBranch={listedBranch(visible, requestedBranch)}
      showGoodsReceipt={ctx.isSuperAdmin || ctx.fnbModulePermissions.goods_receipt_expiry}
      showMenuSales={ctx.isSuperAdmin || ctx.fnbModulePermissions.own_branch_menu_sales}
    />
  );
}
