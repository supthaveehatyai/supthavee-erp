import type { Metadata } from "next";
import {
  getInventoryAdjustments,
  getAdjustmentDetail,
} from "@/lib/actions/inventory-adjustment";
import { INVENTORY_DOC_TYPES } from "@/lib/constants/document";
import type { InventoryDocType } from "@/lib/constants/document";
import { AdjustmentsWorkspace } from "@/app/(erp)/inventory/adjustments/adjustments-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ปรับปรุงคลังสินค้า | Inventory Adjustments",
  description: "STK_OB ยอดยกมา · STK_ADJ ปรับปรุงสต็อก (Ledger-Driven)",
};

type PageProps = {
  searchParams: Promise<{ create?: string; view_id?: string }>;
};

function resolveCreateMode(raw: string | undefined): InventoryDocType | null {
  const value = raw?.trim().toUpperCase() ?? "";
  if ((INVENTORY_DOC_TYPES as readonly string[]).includes(value)) {
    return value as InventoryDocType;
  }
  return null;
}

export default async function InventoryAdjustmentsPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const createMode = resolveCreateMode(params.create);
  const viewId = params.view_id?.trim() ?? null;

  const [listResult, detailResult] = await Promise.all([
    getInventoryAdjustments(),
    viewId ? getAdjustmentDetail(viewId) : Promise.resolve({ data: null, error: null }),
  ]);

  return (
    <AdjustmentsWorkspace
      key={createMode ?? viewId ?? "list"}
      rows={listResult.data}
      error={listResult.error}
      createMode={createMode}
      viewDetail={detailResult.data}
      viewDetailError={detailResult.error}
    />
  );
}
