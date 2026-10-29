import type { ReceiptCostGroup } from "@/lib/utils/receipt-qty-groups";
import { cn } from "@/lib/utils";

type InventoryLandedCostCardProps = {
  finished: ReceiptCostGroup | null;
  raw: ReceiptCostGroup | null;
  originFreight: number;
  destFreight: number;
  destCarrierName: string;
  pool: number;
  poolAverage: string | null;
  formatMoney: (value: number) => string;
};

function Row({
  label,
  amount,
  strong = false,
  caption,
}: {
  label: string;
  amount: string;
  strong?: boolean;
  caption?: string | null;
}) {
  return (
    <div className={cn(strong && "mt-1 border-t border-slate-200 pt-2")}>
      <div className="flex items-start justify-between gap-3 py-1 text-sm">
        <span className={strong ? "font-semibold text-slate-900" : "text-slate-600"}>{label}</span>
        <span className={cn("shrink-0 font-mono tabular-nums", strong && "font-semibold text-slate-900")}>
          {amount}
        </span>
      </div>
      {caption ? <p className="pb-1 text-right text-[11px] text-slate-500">{caption}</p> : null}
    </div>
  );
}

export function InventoryLandedCostCard({
  finished,
  raw,
  originFreight,
  destFreight,
  destCarrierName,
  pool,
  poolAverage,
  formatMoney,
}: InventoryLandedCostCardProps) {
  const split = Boolean(finished && raw);
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="text-xs font-semibold text-slate-800">
        สรุปต้นทุนรับเข้าคลังตามมาตรฐาน TAS 2 — Inventory Landed Cost
      </p>
      {finished ? (
        <Row
          label={`${split ? "มูลค่าสินค้าหลัก (ก่อน VAT)" : "มูลค่าสินค้าสุทธิ (ก่อน VAT)"} • ${finished.qtyLabel}`}
          amount={`฿${formatMoney(finished.exVat)}`}
          caption={finished.goodsAverage || null}
        />
      ) : null}
      {raw ? (
        <Row
          label={`มูลค่าวัตถุดิบ/วัสดุสิ้นเปลือง (ก่อน VAT) • ${raw.qtyLabel}`}
          amount={`฿${formatMoney(raw.exVat)}`}
          caption={raw.goodsAverage || null}
        />
      ) : null}
      <Row label="+ ค่าขนส่งต้นทาง (เข้าต้นทุนสินค้า)" amount={`฿${formatMoney(originFreight)}`} />
      <Row
        label={`+ ค่าขนส่งเก็บปลายทาง (${destCarrierName})`}
        amount={`฿${formatMoney(destFreight)}`}
      />
      <Row
        label="รวมฐานต้นทุนเข้าคลังสุทธิ (Landed Cost Pool)"
        amount={`฿${formatMoney(pool)}`}
        strong
        caption={poolAverage}
      />
    </div>
  );
}
