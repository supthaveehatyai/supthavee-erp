import type { Metadata } from "next";
import { getActiveVendors } from "@/lib/actions/mapping";
import GoodsReceiptUI from "./GoodsReceiptUI";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Smart Goods Receipt | รับสินค้าอัจฉริยะ",
  description:
    "จับคู่รายการจาก OCR กับ vendor_product_mapping เพื่อรับสินค้าเข้าคลัง — Server Actions only",
};

export default async function GoodsReceiptPage() {
  const vendorsResult = await getActiveVendors();

  return (
    <GoodsReceiptUI
      initialVendors={vendorsResult.data}
      initialVendorsError={vendorsResult.error}
    />
  );
}
