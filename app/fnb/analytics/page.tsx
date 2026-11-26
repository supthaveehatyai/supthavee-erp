import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { AnalyticsWorkspace } from "@/app/fnb/analytics/analytics-workspace";

export const dynamic = "force-dynamic";

export default async function FnbAnalyticsPage() {
  await requireSuperAdmin();
  return <AnalyticsWorkspace />;
}
