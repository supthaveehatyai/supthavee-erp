import type { Metadata } from "next";
import { getInventoryAdjustments } from "@/lib/actions/inventory-adjustment";
import { INVENTORY_DOC_TYPES } from "@/lib/constants/document";
import type { InventoryDocType } from "@/lib/constants/document";
import { AdjustmentsWorkspace } from "@/app/(erp)/inventory/adjustments/adjustments-workspace";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "ปรับปรุงคลังสินค้า | Inventory Adjustments",
  description: "STK_OB ยอดยกมา · STK_ADJ ปรับปรุงสต็อก (Ledger-Driven)",
};

type PageProps = {
  searchParams: Promise<{ create?: string }>;
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
  const { data, error } = await getInventoryAdjustments();

  return (
    <AdjustmentsWorkspace
      key={createMode ?? "list"}
      rows={data}
      error={error}
      createMode={createMode}
    />
  );
}
