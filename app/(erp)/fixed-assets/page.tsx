import type { Metadata } from "next";
import { Suspense } from "react";
import {
  getAssetCategories,
  getFixedAssetById,
  getFixedAssets,
  getLinkedExpenseDocumentNo,
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

interface PageProps {
  searchParams: Promise<{
    [key: string]: string | string[] | undefined;
  }>;
}

function readSearchParam(
  params: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return value?.trim() || undefined;
}

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
  const query = readSearchParam(params, "query") ?? "";
  const status = resolveStatusFilter(readSearchParam(params, "status"));
  const createRaw = readSearchParam(params, "create");
  const createOpen = createRaw === "1" || createRaw === "true";
  const editId = readSearchParam(params, "edit_id") || null;
  const linkedExpenseId = readSearchParam(params, "linked_expense_id") || null;
  const viewAssetId = readSearchParam(params, "view_asset_id") || null;

  const [assetsResult, categoriesResult, editResult, linkedExpenseResult, viewAssetResult] =
    await Promise.all([
      getFixedAssets({ query, status }),
      getAssetCategories({ activeOnly: true }),
      editId
        ? getFixedAssetById(editId)
        : Promise.resolve({ data: null, error: null }),
      linkedExpenseId
        ? getLinkedExpenseDocumentNo(linkedExpenseId)
        : Promise.resolve({ documentNo: null, error: null }),
      viewAssetId
        ? getFixedAssetById(viewAssetId)
        : Promise.resolve({ data: null, error: null }),
    ]);

  const editAsset = editResult.data;
  const linkedExpenseDocumentNo = linkedExpenseResult.documentNo;
  const viewAsset = viewAssetResult.data;
  const viewAssetError = viewAssetResult.error;

  const closeViewParams = new URLSearchParams();
  if (query) closeViewParams.set("query", query);
  if (status && status !== "ALL") closeViewParams.set("status", status);
  const viewCloseHref = closeViewParams.toString()
    ? `/fixed-assets?${closeViewParams.toString()}`
    : "/fixed-assets";

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
        query={query}
        status={status}
        createOpen={createOpen}
        editAsset={editAsset}
        linkedExpenseDocumentNo={linkedExpenseDocumentNo}
        viewAsset={viewAsset}
        viewAssetError={viewAssetError}
        viewCloseHref={viewCloseHref}
      />
    </Suspense>
  );
}
