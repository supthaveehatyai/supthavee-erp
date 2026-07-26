"use client";

/**
 * "➕ สร้างสินค้ารุ่นใหม่ (Full Matrix)" — link-out dialog for the On-the-fly
 * mapping flow in Smart Goods Receipt.
 *
 * The full 2-Phase Product Matrix Generator (Phase 1 identity form + Phase 2
 * SKU/pricing grid) lives entirely inside `app/products/products-client.tsx`
 * (the `/products` page) — it is not (yet) extracted into a standalone,
 * embeddable component, so embedding it directly in a Goods Receipt modal
 * would mean duplicating ~2,800 lines of stateful logic. Until that
 * extraction happens, this dialog opens `/products` in a new tab with the
 * current vendor pre-filled via `?vendorId=` (see `products-client.tsx`,
 * which reads it and pre-fills the Vendor field the next time "สร้าง
 * Product Matrix" is opened) — zero risk to the existing Products page.
 */

import { PackagePlus, SquareArrowOutUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export type FullMatrixDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: string;
  /** Optional context label — the OCR raw vendor SKU this creation was triggered from. */
  vendorSkuHint?: string;
};

export default function FullMatrixDialog({
  open,
  onOpenChange,
  vendorId,
  vendorSkuHint,
}: FullMatrixDialogProps) {
  const productsUrl = vendorId
    ? `/products?vendorId=${encodeURIComponent(vendorId)}`
    : "/products";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>➕ สร้างสินค้ารุ่นใหม่ (Full Matrix)</DialogTitle>
          <DialogDescription>
            {vendorSkuHint ? (
              <>
                สำหรับรหัสโรงงาน{" "}
                <code className="rounded bg-slate-100 px-1 py-0.5 text-xs font-semibold text-slate-700">
                  {vendorSkuHint}
                </code>{" "}
                — ยังไม่มีรุ่นสินค้าเดิมให้เลือกเลย ต้องสร้างรุ่นสินค้า
                (Model) ใหม่ทั้งหมดพร้อม Matrix สี/ไซส์
              </>
            ) : (
              "สร้างรุ่นสินค้า (Model) ใหม่ทั้งหมด พร้อม Matrix สี/ไซส์"
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 rounded-xl border border-slate-100 bg-slate-50/70 p-4 text-sm text-slate-600">
          <p>
            การสร้าง Product Matrix แบบเต็ม (Phase 1 + Phase 2) ต้องทำที่หน้า{" "}
            <span className="font-semibold text-slate-800">
              สินค้าและราคา (Product Matrix)
            </span>{" "}
            — ระบบจะเปิดหน้านั้นในแท็บใหม่ พร้อมเตรียมผู้จำหน่ายปัจจุบันไว้ให้แล้ว
          </p>
          <p className="text-xs text-slate-400">
            หลังสร้างเสร็จ กลับมาที่หน้านี้แล้วกด &ldquo;⚡ เพิ่มสี/ไซส์
            จากรุ่นเดิม (Quick Create)&rdquo; เพื่อผูก SKU เข้ากับรายการนี้
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <a
            href={productsUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => onOpenChange(false)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
          >
            <PackagePlus className="size-4" aria-hidden />
            เปิดหน้า Product Matrix
            <SquareArrowOutUpRight className="size-3.5" aria-hidden />
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
