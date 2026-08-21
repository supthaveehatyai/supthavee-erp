import type { Metadata } from "next";
import { Suspense } from "react";
import {
  getAssetCategories,
  getFixedAssetById,
  getFixedAssets,
  getLinkableExpenses,
} from "@/app/actions/fixed-assets";
import type { FixedAssetStatus } from "@/types/fixed-assets";
import { FIXED_ASSET_STATUSES } from "@/types/fixed-assets";
import { FixedAssetsWorkspace } from "@/app/(erp)/fixed-assets/fixed-assets-workspace";

export const dynamic = "force-dynamic";

/** Allow heavy attachment uploads via Server Actions on this segment. */
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "สินทรัพย์ถาวร | Fixed Assets",
  description: "ทะเบียนสินทรัพย์ถาวร (Fixed Asset Register) — Phase 14",
};

type PageProps = {
  searchParams: Promise<{
    query?: string;
    status?: string;
    create?: string;
    edit_id?: string;
  }>;
};

function resolveStatusFilter(
  raw: string | undefined,
): FixedAssetStatus | "ALL" {
  const value = (raw ?? "").trim().toUpperCase();
  if (!value || value === "ALL") return "ALL";
  if ((FIXED_ASSET_STATUSES as readonly string[]).includes(value)) {
    return value as FixedAssetStatus;
  }
  return "ALL";
}

export default async function FixedAssetsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const query = params.query?.trim() ?? "";
  const status = resolveStatusFilter(params.status);
  const createOpen = params.create === "1" || params.create === "true";
  const editId = params.edit_id?.trim() || null;

  const [assetsResult, categoriesResult, expensesResult, editResult] =
    await Promise.all([
      getFixedAssets({ query, status }),
      getAssetCategories({ activeOnly: true }),
      getLinkableExpenses(),
      editId
        ? getFixedAssetById(editId)
        : Promise.resolve({ data: null, error: null }),
    ]);

  const editAsset = editResult.data;

  return (
    <Suspense
      fallback={
        <div className="p-6 text-sm text-slate-500">กำลังโหลดทะเบียนสินทรัพย์...</div>
      }
    >
      <FixedAssetsWorkspace
        rows={assetsResult.data}
        error={assetsResult.error}
        categories={categoriesResult.data}
        categoriesError={categoriesResult.error}
        expenses={expensesResult.data}
        expensesError={expensesResult.error}
        query={query}
        status={status}
        createOpen={createOpen}
        editAsset={editAsset}
      />
    </Suspense>
  );
}
