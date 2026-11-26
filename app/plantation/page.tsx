import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { isSchemaUnavailable, schemaAdmin, SCHEMA_SETUP_MESSAGE } from "@/lib/holding/schema-db";

export const dynamic = "force-dynamic";

const ZONES = [
  { code: "SKH", title: "สวนสงขลา", detail: "น้ำยางสด รายสายกรีด พร้อมสแกนบิลชั่ง" },
  { code: "SNK", title: "สวนสกลนคร", detail: "ขี้ยางรายโซน หักค่าใช้จ่ายหลายแปลง" },
];

export default async function PlantationPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireSuperAdmin();
  const params = await searchParams;
  const listed = await schemaAdmin()
    .schema("agri")
    .from("plantation_zones")
    .select("*")
    .limit(20);
  const schemaMessage = listed.error && isSchemaUnavailable(listed.error) ? SCHEMA_SETUP_MESSAGE : null;
  const rows = Array.isArray(listed.data) ? listed.data as Array<Record<string, unknown>> : [];

  return (
    <div className="space-y-5">
      <div>
        <p className="text-xs font-semibold text-emerald-800">AG</p>
        <h1 className="text-2xl font-bold text-slate-900">สวนยางพารา</h1>
        <p className="text-sm text-slate-500">โซนสงขลาและสกลนคร {params.tab === "zones" ? "· มุมมองโซน" : ""}</p>
      </div>
      {schemaMessage ? <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">{schemaMessage}</div> : null}
      <div className="grid gap-3 md:grid-cols-2">
        {(rows.length > 0 ? rows.map((row) => ({
          code: String(row.zone_code ?? row.zone_id ?? ""),
          title: String(row.zone_name_th ?? row.zone_name ?? row.province ?? "โซนสวน"),
          detail: String(row.product_mode ?? row.notes ?? ""),
        })) : ZONES).map((zone) => (
          <article key={zone.code} className="rounded-xl border border-emerald-100 bg-white p-5">
            <p className="text-xs font-semibold text-emerald-800">{zone.code}</p>
            <h2 className="text-lg font-semibold text-slate-900">{zone.title}</h2>
            <p className="text-sm text-slate-500">{zone.detail}</p>
          </article>
        ))}
      </div>
    </div>
  );
}
