import type { Metadata } from "next";
import { getActiveVendors } from "@/lib/actions/mapping";
import { getPurchaseUoms } from "@/lib/actions/uom-actions";
import GoodsReceiptUI from "./GoodsReceiptUI";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Smart Goods Receipt | รับสินค้าอัจฉริยะ",
  description:
    "จับคู่รายการจาก OCR กับ vendor_product_mapping เพื่อรับสินค้าเข้าคลัง — Server Actions only",
};

export default async function GoodsReceiptPage() {
  const [vendorsResult, uomResult] = await Promise.all([
    getActiveVendors(),
    getPurchaseUoms(),
  ]);

  return (
    <GoodsReceiptUI
      initialVendors={vendorsResult.data}
      initialVendorsError={vendorsResult.error}
      purchaseUoms={uomResult.data}
    />
  );
}
