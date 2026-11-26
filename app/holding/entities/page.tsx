import { listLegalEntitiesAction } from "@/lib/actions/holding-entities";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { EntitiesWorkspace } from "@/app/holding/entities/entities-workspace";

export const dynamic = "force-dynamic";

export default async function HoldingEntitiesPage() {
  await requireSuperAdmin();
  const entities = await listLegalEntitiesAction();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">ทะเบียนนิติบุคคล</h1>
        <p className="text-sm text-slate-500">ทรัพย์ทวี, จัสมิน พลัส, ลิ่มวรวิวัฒน์ และบุคคลในครอบครัว</p>
      </div>
      <EntitiesWorkspace entities={entities.data} schemaMessage={entities.schemaReady ? entities.error : entities.error} />
    </div>
  );
}
