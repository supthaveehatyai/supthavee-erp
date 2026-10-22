"use client";

import { GoodsReceiptSheetHeader } from "@/components/shared/print/GoodsReceiptSheetHeader";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatThaiDate } from "@/lib/utils/date-formatter";
import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import type { PrintCompanyProfile } from "@/types/print-document";

export type ManualReceiptPreviewLine = {
  key: string;
  sku: string;
  name: string;
  qty: number;
  uom: string;
  unitCost: number;
  isFoc: boolean;
  lineTotal: number;
  freight: number;
};

function money(value: number): string {
  return value.toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export function ManualReceiptPreviewDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
  company,
  vendorName,
  vendorAddress,
  vendorTaxId,
  vendorPhone,
  vendorBranchCode,
  docDate,
  documentRef,
  docType,
  docTypeLabel,
  vatLabel,
  lines,
  goodsGross,
  billDiscount,
  originFreight,
  destFreight,
  taxBase,
  vatAmount,
  grandTotal,
  landedPool,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  isPending: boolean;
  company: PrintCompanyProfile;
  vendorName: string;
  vendorAddress?: string | null;
  vendorTaxId?: string | null;
  vendorPhone?: string | null;
  vendorBranchCode?: string | null;
  docDate: string;
  documentRef: string;
  docType: string;
  docTypeLabel: string;
  vatLabel: string;
  lines: ManualReceiptPreviewLine[];
  goodsGross: number;
  billDiscount: number;
  originFreight: number;
  destFreight: number;
  taxBase: number;
  vatAmount: number;
  grandTotal: number;
  landedPool: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto p-0">
        <div className="border-b border-slate-200 px-6 py-4">
          <DialogTitle>ตัวอย่างใบรับสินค้า / ใบสำคัญตั้งหนี้ (Document Preview)</DialogTitle>
          <DialogDescription>
            ตรวจทานฟอร์มเอกสารก่อนยืนยัน ระบบยังไม่บันทึกลงฐานข้อมูล
          </DialogDescription>
        </div>
        <div className="px-4 py-4 text-slate-800">
          <div className="rounded-sm border border-neutral-300 bg-white p-4">
          <GoodsReceiptSheetHeader
            company={company}
            title="ใบรับสินค้า / ใบสำคัญตั้งหนี้การค้า"
            subtitle="(GOODS RECEIPT & AP VOUCHER)"
            partyLabel="ผู้จำหน่าย / VENDOR"
            partyName={vendorName}
            partyBranchCode={vendorBranchCode}
            partyAddress={vendorAddress}
            partyTaxId={vendorTaxId}
            partyPhone={vendorPhone}
            documentNo="DRAFT"
            dateLabel={formatThaiDate(docDate, "long")}
            referenceNo={documentRef}
            docType={docType}
            status="DRAFT"
          />
          <p className="mt-1 text-[10px] text-neutral-500">
            {docTypeLabel} · ภาษี {vatLabel} · เลขที่เอกสารจริงจะออกเมื่อยืนยันบันทึก
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-sm">
              <thead>
                <tr className="border-y border-slate-300 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-2 py-2">รหัส</th>
                  <th className="px-2 py-2">สินค้า</th>
                  <th className="px-2 py-2 text-right">จำนวน</th>
                  <th className="px-2 py-2">หน่วย</th>
                  <th className="px-2 py-2 text-right">ราคา</th>
                  <th className="px-2 py-2 text-right">ปันส่วนขนส่ง</th>
                  <th className="px-2 py-2 text-right">ยอดตั้งหนี้</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => (
                  <tr key={line.key} className="border-b border-slate-100">
                    <td className="px-2 py-2 font-mono text-xs">{line.sku}</td>
                    <td className="px-2 py-2">
                      {line.name}
                      {line.isFoc ? (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">
                          ของแถม
                        </span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {line.qty.toLocaleString("th-TH")}
                    </td>
                    <td className="px-2 py-2">{line.uom}</td>
                    <td className="px-2 py-2 text-right tabular-nums">
                      {line.isFoc ? "0.00" : money(line.unitCost)}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{money(line.freight)}</td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">
                      {money(line.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 ml-auto w-full max-w-sm space-y-1 text-sm">
            <Row label="รวมรายการสินค้า" amount={goodsGross} />
            <Row label="หักส่วนลดท้ายบิล" amount={-billDiscount} />
            <Row label="ค่าขนส่งต้นทาง" amount={originFreight} />
            <Row label="ฐานภาษี" amount={taxBase} />
            <Row label="VAT 7%" amount={vatAmount} />
            <Row label="ยอดสุทธิตั้งหนี้ผู้ขาย" amount={grandTotal} strong />
            <p className="text-right text-[11px] text-slate-500">({numberToThaiBaht(grandTotal)})</p>
            <Row label="ฐานต้นทุนเข้าคลังสุทธิ (TAS 2)" amount={landedPool} />
            {destFreight > 0 ? (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
                ค่าขนส่งปลายทางจ่ายแยก ฿{money(destFreight)} ไม่รวมในหนี้ผู้ขาย
              </p>
            ) : null}
          </div>
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            กลับไปแก้ไข
          </Button>
          <Button
            type="button"
            disabled={isPending}
            onClick={onConfirm}
            className="bg-emerald-600 hover:bg-emerald-700"
          >
            {isPending ? "กำลังบันทึก..." : "ยืนยันออกเอกสารรับสินค้าจริง (Post to Ledger)"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({
  label,
  amount,
  strong = false,
}: {
  label: string;
  amount: number;
  strong?: boolean;
}) {
  return (
    <div className={strong ? "flex justify-between border-t border-slate-200 pt-1 font-semibold" : "flex justify-between"}>
      <span>{label}</span>
      <span className="tabular-nums">{money(amount)}</span>
    </div>
  );
}
