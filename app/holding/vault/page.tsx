import { listLegalEntitiesAction } from "@/lib/actions/holding-entities";
import { listCorporateDocumentsAction } from "@/lib/actions/holding-vault";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { SCHEMA_SETUP_MESSAGE } from "@/lib/holding/schema-db";
import { VaultWorkspace } from "@/app/holding/vault/vault-workspace";

export const dynamic = "force-dynamic";

export default async function HoldingVaultPage({
  searchParams,
}: {
  searchParams: Promise<{ workspace?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const [documents, entities] = await Promise.all([
    listCorporateDocumentsAction(),
    listLegalEntitiesAction(),
  ]);
  const schemaMessage = !documents.schemaReady || !entities.schemaReady
    ? documents.error || entities.error || SCHEMA_SETUP_MESSAGE
    : documents.error || entities.error;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">คลังเอกสารบริษัท</h1>
        <p className="text-sm text-slate-500">ไฟล์อยู่ถังส่วนตัว corporate_vault และเปิดด้วยลิงก์ลงนาม 1 ชั่วโมง</p>
      </div>
      <VaultWorkspace
        documents={documents.data}
        entities={entities.data}
        schemaMessage={schemaMessage}
        initialWorkspace={params.workspace ?? ""}
      />
    </div>
  );
}
