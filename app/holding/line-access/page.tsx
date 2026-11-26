import { headers } from "next/headers";
import { listLiffRegistrationsAction, listLineChannelsAction } from "@/lib/actions/holding-entities";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { resolveCanonicalProductionBaseUrl } from "@/lib/line/line-target";
import { LineAccessWorkspace } from "@/app/holding/line-access/line-access-workspace";

export const dynamic = "force-dynamic";

export default async function HoldingLineAccessPage() {
  await requireSuperAdmin();
  const [channels, registrations] = await Promise.all([
    listLineChannelsAction(),
    listLiffRegistrationsAction(),
  ]);
  const headerStore = await headers();
  const host = headerStore.get("x-forwarded-host") ?? headerStore.get("host") ?? "";
  const proto = headerStore.get("x-forwarded-proto") ?? "https";
  const webhookBase = resolveCanonicalProductionBaseUrl() ?? (host ? `${proto}://${host}` : "");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">LINE OA และสิทธิ์ LIFF</h1>
        <p className="text-sm text-slate-500">Webhook ของแต่ละธุรกิจแยกจาก @hzr1801v</p>
      </div>
      <LineAccessWorkspace
        channels={channels.data}
        registrations={registrations.data}
        schemaMessage={channels.error || registrations.error}
        webhookBase={webhookBase}
      />
    </div>
  );
}
