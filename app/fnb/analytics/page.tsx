import { requireFnbModuleAccess } from "@/lib/holding/workspace-access";
import { AnalyticsWorkspace } from "@/app/fnb/analytics/analytics-workspace";

export const dynamic = "force-dynamic";

export default async function FnbAnalyticsPage() {
  await requireFnbModuleAccess("all_branch_analytics");
  return <AnalyticsWorkspace />;
}
