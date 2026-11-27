import { getFnbPeoplePayloadAction } from "@/lib/actions/fnb-people";
import { requireFnbPeopleAccess } from "@/lib/holding/workspace-access";
import { FnbPeopleWorkspace } from "./people-workspace";

export const dynamic = "force-dynamic";

export default async function FnbPeoplePage() {
  await requireFnbPeopleAccess();
  const payload = await getFnbPeoplePayloadAction();
  if (!payload.data) return <p className="p-6 text-sm text-red-700">{payload.error}</p>;
  return <FnbPeopleWorkspace payload={payload.data} />;
}
