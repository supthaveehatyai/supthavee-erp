import type { Metadata } from "next";
import { getActiveVendors } from "@/lib/actions/mapping";
import { getPurchaseUoms } from "@/lib/actions/uom-actions";
import { getActiveCarriers } from "@/lib/actions/carrier-actions";
import { getSystemSettings } from "@/lib/actions/settings";
import { toPrintCompanyProfile } from "@/lib/print/company-profile";
import ManualReceiptWorkspace from "./manual-receipt-workspace";
import {
  GOODS_RECEIPT_TABS,
  PageModeTabs,
} from "@/components/shared/page-mode-tabs";

export const metadata: Metadata = {
  title: "รับสินค้าเข้าคลัง (Manual) | Purchases",
  description: "กรอกข้อมูลรับสินค้าเข้าคลังเอง โดยไม่ผ่าน OCR",
};

/**
 * Server Component — loads vendors via Service Role, then Client workspace.
 */
export default async function ManualGoodsReceiptPage() {
  const [vendorsResult, uomResult, carrierResult, settingsResult] = await Promise.all([
    getActiveVendors(),
    getPurchaseUoms(),
    getActiveCarriers(),
    getSystemSettings(),
  ]);
  const company = toPrintCompanyProfile(
    settingsResult.success ? settingsResult.data : null,
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5">
      <PageModeTabs
        tabs={GOODS_RECEIPT_TABS}
        activeKey="manual"
        ariaLabel="รับสินค้าเข้าคลัง"
      />
      <ManualReceiptWorkspace
      vendors={vendorsResult.data}
      vendorsError={vendorsResult.error}
      purchaseUoms={uomResult.data}
      initialCarriers={carrierResult.data}
      company={company}
    />
    </div>
  );
}
