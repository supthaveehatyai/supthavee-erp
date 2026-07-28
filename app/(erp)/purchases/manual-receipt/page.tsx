import type { Metadata } from "next";
import { getActiveVendors } from "@/lib/actions/mapping";
import ManualReceiptWorkspace from "./manual-receipt-workspace";

export const metadata: Metadata = {
  title: "รับสินค้าเข้าคลัง (Manual) | Purchases",
  description: "กรอกข้อมูลรับสินค้าเข้าคลังเอง โดยไม่ผ่าน OCR",
};

/**
 * Server Component — loads vendors via Service Role, then Client workspace.
 */
export default async function ManualGoodsReceiptPage() {
  const vendorsResult = await getActiveVendors();

  return (
    <ManualReceiptWorkspace
      vendors={vendorsResult.data}
      vendorsError={vendorsResult.error}
    />
  );
}
