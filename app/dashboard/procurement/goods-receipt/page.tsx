import type { Metadata } from "next";
import GoodsReceiptUI from "./GoodsReceiptUI";

export const metadata: Metadata = {
  title: "Smart Goods Receipt | รับสินค้าอัจฉริยะ",
  description:
    "จับคู่รายการจาก OCR กับ vendor_product_mapping เพื่อรับสินค้าเข้าคลัง — Server Actions only",
};

export default function GoodsReceiptPage() {
  return <GoodsReceiptUI />;
}
