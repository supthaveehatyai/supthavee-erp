import { listFnbStockAction } from "@/lib/actions/fnb-inventory";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { InventoryWorkspace } from "@/app/fnb/inventory/inventory-workspace";

export const dynamic = "force-dynamic";

export default async function FnbInventoryPage() {
  await requireSuperAdmin();
  const [branches, stock] = await Promise.all([listFnbBranchOptionsAction(), listFnbStockAction()]);
  return <InventoryWorkspace branches={branches.data} balances={stock.data} />;
}
