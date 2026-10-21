import type { Metadata } from "next";
import { getActiveVendors } from "@/lib/actions/mapping";
import { getPurchaseUoms } from "@/lib/actions/uom-actions";
import { getActiveCarriers } from "@/lib/actions/carrier-actions";
import GoodsReceiptUI from "./GoodsReceiptUI";
import {
  GOODS_RECEIPT_TABS,
  PageModeTabs,
} from "@/components/shared/page-mode-tabs";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const metadata: Metadata = {
  title: "Smart Goods Receipt | รับสินค้าอัจฉริยะ",
  description:
    "จับคู่รายการจาก OCR กับ vendor_product_mapping เพื่อรับสินค้าเข้าคลัง — Server Actions only",
};

export default async function GoodsReceiptPage() {
  const [vendorsResult, uomResult, carrierResult] = await Promise.all([
    getActiveVendors(),
    getPurchaseUoms(),
    getActiveCarriers(),
  ]);

  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <PageModeTabs
        tabs={GOODS_RECEIPT_TABS}
        activeKey="ocr"
        ariaLabel="รับสินค้าเข้าคลัง"
      />
      <GoodsReceiptUI
      initialVendors={vendorsResult.data}
      initialVendorsError={vendorsResult.error}
      purchaseUoms={uomResult.data}
      initialCarriers={carrierResult.data}
    />
    </div>
  );
}
