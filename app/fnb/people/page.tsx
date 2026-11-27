import { Suspense } from "react";
import { FnbBrandBar } from "@/components/fnb/fnb-brand-bar";
import { getFnbPeoplePayloadAction } from "@/lib/actions/fnb-people";
import { fnbToneClass, resolveActiveBrand } from "@/lib/fnb/active-brand";
import { requireFnbPeopleAccess } from "@/lib/holding/workspace-access";
import { FnbPeopleWorkspace } from "./people-workspace";

export const dynamic = "force-dynamic";

export default async function FnbPeoplePage({ searchParams }: { searchParams: Promise<{ brand?: string }> }) {
  const ctx = await requireFnbPeopleAccess();
  const brand = resolveActiveBrand(ctx.isSuperAdmin, ctx.assignedBrandCode, (await searchParams).brand);
  const payload = await getFnbPeoplePayloadAction(brand);
  if (!payload.data) return <p className="p-6 text-sm text-red-700">{payload.error}</p>;
  return (
    <div className={`space-y-4 ${fnbToneClass(brand)}`}>
      <Suspense fallback={null}><FnbBrandBar isSuperAdmin={ctx.isSuperAdmin} brand={brand} /></Suspense>
      <FnbPeopleWorkspace payload={payload.data} />
    </div>
  );
}
