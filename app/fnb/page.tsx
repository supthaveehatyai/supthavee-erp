import { listFnbBranchesAction } from "@/lib/actions/holding-entities";
import { getFnbDashboardAction, listPendingShiftApprovalsAction } from "@/lib/actions/fnb-operations";
import { listEarlyWarningsAction } from "@/lib/actions/fnb-sop";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import type { FnbBranchRow } from "@/types/holding";
import { FnbHub } from "@/app/fnb/fnb-hub";

export const dynamic = "force-dynamic";

const FALLBACK_BRANCHES: FnbBranchRow[] = [
  { id: "LC-HDY", branch_code: "LC-HDY", branch_name: "Lucky Cup สาขาหาดใหญ่ (เพชรเกษม)", brand_code: "LUCKY_CUP", brand_name: "Lucky Cup", is_active: true, countdown_until: null },
  { id: "LC-PSU", branch_code: "LC-PSU", branch_name: "Lucky Cup สาขา PSU (ทุ่งรี-ม.อ.)", brand_code: "LUCKY_CUP", brand_name: "Lucky Cup", is_active: true, countdown_until: null },
  { id: "CT-KLN", branch_code: "CT-KLN", branch_name: "ชาทรตะโหมด สาขาคลองแงะ", brand_code: "CHATORN", brand_name: "ชาทรตะโหมด", is_active: true, countdown_until: null },
  { id: "CT-BNP", branch_code: "CT-BNP", branch_name: "ชาทรตะโหมด สาขาบ้านพรุ", brand_code: "CHATORN", brand_name: "ชาทรตะโหมด", is_active: true, countdown_until: "2026-12-26" },
  { id: "CT-NMM", branch_code: "CT-NMM", branch_name: "ชาทรตะโหมด สาขานาหม่อม", brand_code: "CHATORN", brand_name: "ชาทรตะโหมด", is_active: true, countdown_until: null },
];

export default async function FnbPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const [listed, dashboard, approvals, warnings] = await Promise.all([
    listFnbBranchesAction(),
    getFnbDashboardAction(),
    listPendingShiftApprovalsAction(),
    listEarlyWarningsAction(),
  ]);
  const branches = listed.data.length > 0 ? listed.data : FALLBACK_BRANCHES;
  return (
    <FnbHub
      branches={branches}
      kpis={dashboard.data}
      schemaMessage={listed.schemaReady && dashboard.schemaReady ? null : listed.error ?? dashboard.error}
      initialTab={params.tab ?? ""}
      approvals={approvals.data}
      parAlerts={warnings.data.par}
      expiryAlerts={warnings.data.expiry}
    />
  );
}
