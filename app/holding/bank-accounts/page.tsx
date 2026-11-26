import { listHoldingBankAccountsAction, listLegalEntitiesAction } from "@/lib/actions/holding-entities";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { HoldingBankWorkspace } from "@/app/holding/bank-accounts/bank-workspace";

export const dynamic = "force-dynamic";

export default async function HoldingBankAccountsPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const [accounts, entities] = await Promise.all([
    listHoldingBankAccountsAction(params.workspace),
    listLegalEntitiesAction(),
  ]);
  const schemaMessage = accounts.error || entities.error;
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">สมุดบัญชีและ QR รับเงินทุกธุรกิจ</h1>
        <p className="text-sm text-slate-500">บจก.ลิ่มวรวิวัฒน์, Lucky Cup, ชาทร, บ้านเช่า และสวนยาง</p>
      </div>
      <HoldingBankWorkspace
        accounts={accounts.data}
        entities={entities.data}
        schemaMessage={schemaMessage}
        initialWorkspace={params.workspace ?? ""}
      />
    </div>
  );
}
