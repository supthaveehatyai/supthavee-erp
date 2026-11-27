import { getHoldingPeopleHubAction } from "@/lib/actions/holding-people";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { PeopleHub } from "./people-hub";

export const dynamic = "force-dynamic";

export default async function HoldingPeoplePage() {
  await requireSuperAdmin();
  const hub = await getHoldingPeopleHubAction();
  if (!hub.data) {
    return <p className="p-6 text-sm text-red-700">{hub.error}</p>;
  }
  return <PeopleHub hub={hub.data} />;
}
