import { listFnbBranchesAction } from "@/lib/actions/holding-entities";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import type { FnbBranchRow } from "@/types/holding";
import { FnbHub } from "@/app/fnb/fnb-hub";

export const dynamic = "force-dynamic";

const FALLBACK_BRANCHES: FnbBranchRow[] = [
  { id: "lc-hy", branch_code: "LC-HY", branch_name: "หาดใหญ่", brand_code: "LUCKY", brand_name: "Lucky Cup", is_active: true, countdown_until: null },
  { id: "lc-sk", branch_code: "LC-SK", branch_name: "สงขลา", brand_code: "LUCKY", brand_name: "Lucky Cup", is_active: true, countdown_until: null },
  { id: "ct-tm", branch_code: "CT-TM", branch_name: "ตะโหมด", brand_code: "CHATR", brand_name: "ชาทรตะโหมด", is_active: true, countdown_until: null },
  { id: "ct-hy", branch_code: "CT-HY", branch_name: "หาดใหญ่", brand_code: "CHATR", brand_name: "ชาทรตะโหมด", is_active: true, countdown_until: null },
  { id: "ct-bnp", branch_code: "CT-BNP", branch_name: "บางนา", brand_code: "CHATR", brand_name: "ชาทรตะโหมด", is_active: true, countdown_until: "2026-12-26" },
];

export default async function FnbPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const listed = await listFnbBranchesAction();
  const branches = listed.data.length > 0 ? listed.data : FALLBACK_BRANCHES;
  return (
    <FnbHub
      branches={branches}
      schemaMessage={listed.schemaReady ? null : listed.error}
      initialTab={params.tab ?? ""}
    />
  );
}
