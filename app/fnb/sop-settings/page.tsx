import { listFnbItemsAction } from "@/lib/actions/fnb-items";
import { listFnbBranchOptionsAction } from "@/lib/actions/fnb-operations";
import { listSopTemplatesAction } from "@/lib/actions/fnb-sop";
import { requireFnbExecutiveAccess } from "@/lib/holding/workspace-access";
import { SopSettingsWorkspace } from "@/app/fnb/sop-settings/sop-settings-workspace";

export const dynamic = "force-dynamic";

export default async function SopSettingsPage() {
  await requireFnbExecutiveAccess();
  const [branches, templates, items] = await Promise.all([
    listFnbBranchOptionsAction(),
    listSopTemplatesAction(),
    listFnbItemsAction(),
  ]);
  return (
    <SopSettingsWorkspace
      branches={branches.data}
      templates={templates.data}
      items={items.data.items.map((item) => ({ id: item.id, short_code: item.short_code, name_th: item.name_th }))}
      schemaMessage={branches.error || templates.error || items.error}
    />
  );
}
