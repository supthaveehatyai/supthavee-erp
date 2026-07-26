import type { Metadata } from "next";
import BulkMatrixMappingUI from "@/components/procurement/BulkMatrixMappingUI";

/** Always fetch fresh mapping data — never serve a static snapshot. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Smart Bulk Matrix Mapping | Vendor Mapping",
  description:
    "จับคู่รหัสโรงงานแบบ Bulk ตามรุ่นสินค้า — Nested Grouping Model → SKU พร้อม Vendor SKU Pattern",
};

/**
 * Vendor Mapping — Smart Bulk Matrix Mapping
 * Accordion models → SKU inputs → Save Mapping + existing mappings list
 */
export default function VendorMappingPage() {
  return (
    <div className="mx-auto flex max-w-[1400px] flex-col gap-5">
      <header>
        <p className="text-xs font-semibold text-blue-600">
          PHASE 3 · PROCUREMENT
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-950">
          Smart Bulk Matrix Mapping
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          จับคู่รหัสโรงงานทั้งรุ่น — กรอก Vendor SKU ต่อ SKU แล้วบันทึกแบบ bulk
          upsert
        </p>
      </header>

      <BulkMatrixMappingUI />
    </div>
  );
}
