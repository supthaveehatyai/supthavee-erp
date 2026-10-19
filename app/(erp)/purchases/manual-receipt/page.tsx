import type { Metadata } from "next";
import { getActiveVendors } from "@/lib/actions/mapping";
import { getPurchaseUoms } from "@/lib/actions/uom-actions";
import ManualReceiptWorkspace from "./manual-receipt-workspace";

export const metadata: Metadata = {
  title: "รับสินค้าเข้าคลัง (Manual) | Purchases",
  description: "กรอกข้อมูลรับสินค้าเข้าคลังเอง โดยไม่ผ่าน OCR",
};

/**
 * Server Component — loads vendors via Service Role, then Client workspace.
 */
export default async function ManualGoodsReceiptPage() {
  const [vendorsResult, uomResult] = await Promise.all([
    getActiveVendors(),
    getPurchaseUoms(),
  ]);

  return (
    <ManualReceiptWorkspace
      vendors={vendorsResult.data}
      vendorsError={vendorsResult.error}
      purchaseUoms={uomResult.data}
    />
  );
}
