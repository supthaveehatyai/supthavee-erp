import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import type {
  DocumentPrintSummaryProps,
  PrintVatType,
} from "@/types/print-document";
import { cn } from "@/lib/utils";

function round2(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

function formatMoney(value: number): string {
  return round2(value).toLocaleString("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function normalizeVatType(value: string | undefined): PrintVatType {
  if (value === "INCLUSIVE" || value === "EXCLUSIVE" || value === "NONE") {
    return value;
  }
  return "NONE";
}

/**
 * ถอดฐานภาษีตามหลักบัญชี (TFRS / Phase 11)
 * - INCLUSIVE: Base = grandTotal × 100 / (100 + rate), VAT = grand − Base
 * - EXCLUSIVE: Base = subtotal − discount, VAT = Base × rate / 100
 * - NONE: Base = subtotal − discount, VAT = 0
 */
export function computePrintVatBreakdown(input: {
  subtotal: number;
  discountAmount: number;
  vatType: PrintVatType;
  vatRate: number;
  grandTotal: number;
}): { baseAmount: number; vatAmount: number; afterDiscount: number } {
  const subtotal = round2(input.subtotal);
  const discountAmount = round2(Math.max(0, input.discountAmount));
  const afterDiscount = round2(Math.max(0, subtotal - discountAmount));
  const vatRate =
    Number.isFinite(input.vatRate) && input.vatRate >= 0 ? input.vatRate : 7;
  const grandTotal = round2(input.grandTotal);
  const vatType = normalizeVatType(input.vatType);

  if (vatType === "NONE" || vatRate === 0) {
    return { baseAmount: afterDiscount, vatAmount: 0, afterDiscount };
  }

  if (vatType === "INCLUSIVE") {
    const baseAmount = round2((grandTotal * 100) / (100 + vatRate));
    const vatAmount = round2(grandTotal - baseAmount);
    return { baseAmount, vatAmount, afterDiscount };
  }

  // EXCLUSIVE
  const baseAmount = afterDiscount;
  const vatAmount = round2(baseAmount * (vatRate / 100));
  return { baseAmount, vatAmount, afterDiscount };
}

function SummaryRow({
  label,
  value,
  emphasize,
}: {
  label: string;
  value: string;
  emphasize?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-6",
        emphasize && "border-t border-neutral-400 pt-1.5",
      )}
    >
      <span
        className={cn(
          "text-neutral-600",
          emphasize && "font-bold text-neutral-950",
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "tabular-nums text-neutral-900",
          emphasize && "font-bold text-neutral-950",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/**
 * สรุปยอดท้ายบิลสำหรับเอกสารพิมพ์ (ชิดขวา) + ตัวอักษรไทยของยอดสุทธิ
 */
export function DocumentPrintSummary({
  subtotal,
  discountAmount,
  vatType: vatTypeProp,
  vatRate,
  grandTotal,
  withholdingTaxAmount,
  discountText,
  className,
}: DocumentPrintSummaryProps) {
  const vatType = normalizeVatType(vatTypeProp);
  const safeSubtotal = round2(subtotal);
  const safeDiscount = round2(Math.max(0, discountAmount));
  const safeGrand = round2(grandTotal);
  const safeWht = round2(Math.max(0, Number(withholdingTaxAmount ?? 0)));

  const { baseAmount, vatAmount, afterDiscount } = computePrintVatBreakdown({
    subtotal: safeSubtotal,
    discountAmount: safeDiscount,
    vatType,
    vatRate,
    grandTotal: safeGrand,
  });

  const showSubtotal = safeSubtotal !== 0;
  const showDiscount = safeDiscount > 0;
  const showAfterDiscount = showDiscount && afterDiscount !== safeSubtotal;
  const showVat = vatType !== "NONE" && vatAmount > 0;
  const showBaseBeforeVat =
    showVat && vatType === "INCLUSIVE" && baseAmount > 0;
  const showWht = safeWht > 0;
  const netPayable = showWht ? round2(safeGrand - safeWht) : safeGrand;
  const thaiBahtText = numberToThaiBaht(safeGrand);

  const vatLabel =
    vatType === "INCLUSIVE"
      ? `ภาษีมูลค่าเพิ่ม ${vatRate}% (Inclusive)`
      : vatType === "EXCLUSIVE"
        ? `ภาษีมูลค่าเพิ่ม ${vatRate}% (Exclusive)`
        : `ภาษีมูลค่าเพิ่ม ${vatRate}%`;

  return (
    <div
      className={cn(
        "ml-auto flex w-full max-w-xs flex-col gap-2 text-xs",
        className,
      )}
    >
      <div className="space-y-1.5 border border-neutral-300 bg-white p-2.5">
        {showSubtotal ? (
          <SummaryRow label="รวมเป็นเงิน" value={formatMoney(safeSubtotal)} />
        ) : null}

        {showDiscount ? (
          <SummaryRow
            label={
              discountText?.trim()
                ? `ส่วนลด (${discountText.trim()})`
                : "ส่วนลด"
            }
            value={`−${formatMoney(safeDiscount)}`}
          />
        ) : null}

        {showAfterDiscount ? (
          <SummaryRow
            label="ยอดหลังหักส่วนลด"
            value={formatMoney(afterDiscount)}
          />
        ) : null}

        {showBaseBeforeVat ? (
          <SummaryRow
            label="มูลค่าสินค้า/บริการ (ก่อน VAT)"
            value={formatMoney(baseAmount)}
          />
        ) : null}

        {showVat ? (
          <SummaryRow label={vatLabel} value={formatMoney(vatAmount)} />
        ) : null}

        <SummaryRow
          label="ยอดสุทธิ"
          value={formatMoney(safeGrand)}
          emphasize
        />

        {showWht ? (
          <>
            <SummaryRow
              label="หักภาษี ณ ที่จ่าย"
              value={`−${formatMoney(safeWht)}`}
            />
            <SummaryRow
              label="ยอดชำระสุทธิ"
              value={formatMoney(netPayable)}
              emphasize
            />
          </>
        ) : null}
      </div>

      <p className="text-right text-[11px] font-medium leading-snug text-neutral-800">
        ({thaiBahtText})
      </p>
    </div>
  );
}
