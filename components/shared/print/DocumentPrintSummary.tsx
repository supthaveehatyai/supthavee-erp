import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import { isRefundDocType } from "@/lib/constants/document";
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
 * - extractFromGrand: บังคับถอดฐานจากยอดสุทธิ (ใช้กับ Refund ที่ inherit VAT)
 */
export function computePrintVatBreakdown(input: {
  subtotal: number;
  discountAmount: number;
  vatType: PrintVatType;
  vatRate: number;
  grandTotal: number;
  extractFromGrand?: boolean;
  vatAmount?: number | null;
}): { baseAmount: number; vatAmount: number; afterDiscount: number } {
  const subtotal = round2(input.subtotal);
  const discountAmount = round2(Math.max(0, input.discountAmount));
  const afterDiscount = round2(Math.max(0, subtotal - discountAmount));
  const vatRate =
    Number.isFinite(input.vatRate) && input.vatRate >= 0 ? input.vatRate : 7;
  const grandTotal = round2(input.grandTotal);
  const vatType = normalizeVatType(input.vatType);
  const overrideVat = Number(input.vatAmount);
  if (
    !input.extractFromGrand &&
    input.vatAmount != null &&
    Number.isFinite(overrideVat) &&
    vatType !== "NONE"
  ) {
    const vatAmount = round2(Math.max(0, overrideVat));
    const baseAmount =
      vatType === "INCLUSIVE" ? round2(grandTotal - vatAmount) : afterDiscount;
    return { baseAmount, vatAmount, afterDiscount };
  }

  if (vatType === "NONE" || vatRate === 0) {
    return { baseAmount: afterDiscount, vatAmount: 0, afterDiscount };
  }

  if (input.extractFromGrand || vatType === "INCLUSIVE") {
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
  freightCost,
  discountAmount,
  vatType: vatTypeProp,
  vatRate,
  vatAmount: vatAmountProp,
  vatLabel: vatLabelProp,
  grandTotal,
  withholdingTaxAmount,
  discountText,
  className,
  docType,
  hideBahtText = false,
  showEmptyRows = false,
  purchaseInclusiveLayout = false,
  depositDeduction = null,
  netBeforeVat = null,
  shippingFee = null,
  shippingMethodLabel = null,
  salesCollection = null,
  collectionNetLabel = null,
  collectionGrandLabel = null,
  whtRowLabel = null,
  netReceivedLabel = null,
  netReceivedAmount = null,
}: DocumentPrintSummaryProps) {
  const vatType = normalizeVatType(vatTypeProp);
  const extractFromGrand = isRefundDocType(String(docType ?? ""));
  const safeFreight = round2(Math.max(0, Number(freightCost ?? 0)));
  const safeSubtotal = round2(subtotal);
  const linesSubtotal =
    safeFreight > 0 ? round2(Math.max(0, safeSubtotal - safeFreight)) : safeSubtotal;
  const safeDiscount = round2(Math.max(0, discountAmount));
  const safeGrand = round2(grandTotal);
  const safeShipping = round2(Math.max(0, Number(shippingFee ?? 0)));
  const shippingLabel = `ค่าขนส่ง (${shippingMethodLabel?.trim() || "ไม่คิด VAT"})`;
  const safeWht = round2(Math.max(0, Number(withholdingTaxAmount ?? 0)));
  const safeVatRate =
    vatType === "NONE"
      ? 0
      : Number.isFinite(vatRate) && vatRate > 0
        ? vatRate
        : 7;

  const { baseAmount, vatAmount, afterDiscount } = computePrintVatBreakdown({
    subtotal: extractFromGrand ? safeGrand : safeSubtotal,
    discountAmount: extractFromGrand ? 0 : safeDiscount,
    vatType,
    vatRate: safeVatRate,
    grandTotal: safeGrand,
    extractFromGrand,
    vatAmount: vatAmountProp,
  });

  const showLinesSubtotal =
    !extractFromGrand && safeFreight > 0 && linesSubtotal !== 0;
  const showFreight = !extractFromGrand && safeFreight > 0;
  const showSubtotal =
    !extractFromGrand && !showLinesSubtotal && safeSubtotal !== 0;
  const showCombinedSubtotal =
    !extractFromGrand && showFreight && safeSubtotal !== 0;
  const showDiscount = !extractFromGrand && (safeDiscount > 0 || showEmptyRows);
  const showAfterDiscount =
    !extractFromGrand && showDiscount && afterDiscount !== safeSubtotal;
  const showVat =
    (vatType !== "NONE" && vatAmount > 0) ||
    (showEmptyRows && (vatType !== "NONE" || vatAmount > 0 || Boolean(vatLabelProp?.trim())));
  const showBaseBeforeVat =
    showVat && (vatType === "INCLUSIVE" || extractFromGrand) && baseAmount > 0;
  const showWht = safeWht > 0;
  const collectionGrand = salesCollection
    ? round2(salesCollection.grand)
    : null;
  const netPayable = collectionGrand ?? (showWht ? round2(safeGrand - safeWht) : safeGrand);
  const thaiBahtText = numberToThaiBaht(collectionGrand ?? safeGrand);
  const depositGross = round2(Math.max(0, Number(depositDeduction?.gross ?? 0)));
  const showDeposit = depositGross > 0;
  const settledNet = round2(
    Number.isFinite(Number(netBeforeVat))
      ? Number(netBeforeVat)
      : baseAmount,
  );

  const vatLabel =
    vatLabelProp?.trim() ||
    (vatType === "INCLUSIVE"
      ? `ภาษีมูลค่าเพิ่ม ${safeVatRate}% (Inclusive)`
      : vatType === "EXCLUSIVE"
        ? `ภาษีมูลค่าเพิ่ม ${safeVatRate}% (Exclusive)`
        : `ภาษีมูลค่าเพิ่ม ${safeVatRate}%`);

  return (
    <div
      className={cn(
        "ml-auto flex w-full max-w-xs flex-col gap-2 text-xs",
        className,
      )}
    >
      <div className="space-y-1.5 border border-neutral-300 bg-white p-2.5">
        {salesCollection ? (
          <>
            <SummaryRow
              label="รวมเป็นเงิน (ค่าสินค้า)"
              value={formatMoney(salesCollection.goods)}
            />
            {salesCollection.discount > 0 ? (
              <SummaryRow
                label="หักส่วนลด"
                value={`−${formatMoney(salesCollection.discount)}`}
              />
            ) : null}
            {salesCollection.deposit > 0 ? (
              <SummaryRow
                label={`หักเงินมัดจำรับล่วงหน้า${
                  salesCollection.depositDocNo
                    ? ` (${salesCollection.depositDocNo})`
                    : ""
                }`}
                value={`−${formatMoney(salesCollection.deposit)}`}
              />
            ) : null}
            <SummaryRow
              label={
                collectionNetLabel?.trim() ||
                (salesCollection.deposit > 0
                  ? "มูลค่าสินค้า/บริการหลังหักมัดจำ (ก่อน VAT)"
                  : "มูลค่าสินค้า/บริการ (ก่อน VAT)")
              }
              value={formatMoney(salesCollection.netBeforeVat)}
            />
            <SummaryRow
              label={`ภาษีมูลค่าเพิ่ม ${salesCollection.vatRate}%`}
              value={formatMoney(salesCollection.vatAmount)}
            />
            {salesCollection.shipping > 0 ? (
              <SummaryRow
                label="ค่าขนส่ง (ยกเว้น VAT)"
                value={`+${formatMoney(salesCollection.shipping)}`}
              />
            ) : null}
            <SummaryRow
              label={collectionGrandLabel?.trim() || "ยอดสุทธิที่ต้องชำระ (Grand Total)"}
              value={formatMoney(salesCollection.grand)}
              emphasize
            />
          </>
        ) : purchaseInclusiveLayout && vatType === "INCLUSIVE" ? (
          <>
            <SummaryRow
              label="รวมมูลค่าสินค้า (รวมภาษี)"
              value={formatMoney(safeGrand)}
            />
            <SummaryRow
              label="มูลค่าก่อนภาษี (ฐานต้นทุน TAS 2)"
              value={formatMoney(baseAmount)}
            />
            <SummaryRow
              label={`ภาษีมูลค่าเพิ่ม ${safeVatRate}% (VAT)`}
              value={formatMoney(vatAmount)}
            />
            {safeShipping > 0 ? (
              <SummaryRow label={shippingLabel} value={`+${formatMoney(safeShipping)}`} />
            ) : null}
            <SummaryRow
              label="ยอดสุทธิ (Grand Total)"
              value={formatMoney(safeGrand)}
              emphasize
            />
          </>
        ) : showDeposit ? (
          <>
            <SummaryRow label="รวมมูลค่าสินค้า" value={formatMoney(safeSubtotal)} />
            <SummaryRow
              label={`หักเงินมัดจำ ตามใบกำกับภาษีมัดจำ ${depositDeduction?.reference?.trim() || ""}`.trim()}
              value={`−${formatMoney(depositGross)}`}
            />
            <SummaryRow
              label="มูลค่ามัดจำก่อนภาษี"
              value={formatMoney(Number(depositDeduction?.net ?? 0))}
            />
            <SummaryRow
              label="ภาษีมูลค่าเพิ่มของเงินมัดจำ"
              value={formatMoney(Number(depositDeduction?.vat ?? 0))}
            />
            <SummaryRow
              label="มูลค่าสินค้าหลังหักเงินมัดจำ"
              value={formatMoney(settledNet)}
            />
            <SummaryRow label={vatLabel} value={formatMoney(vatAmount)} />
            {safeShipping > 0 ? (
              <SummaryRow label={shippingLabel} value={`+${formatMoney(safeShipping)}`} />
            ) : null}
            <SummaryRow
              label="ยอดชำระสุทธิ"
              value={formatMoney(safeGrand)}
              emphasize
            />
          </>
        ) : (
        <>
        {showLinesSubtotal ? (
          <SummaryRow
            label={showEmptyRows ? "ยอดรวมสินค้า (Subtotal)" : "รวมรายการสินค้า"}
            value={formatMoney(linesSubtotal)}
          />
        ) : null}

        {showFreight ? (
          <SummaryRow
            label="ค่าขนส่งต้นทาง"
            value={formatMoney(safeFreight)}
          />
        ) : null}

        {showCombinedSubtotal ? (
          <SummaryRow label="รวมเป็นเงิน" value={formatMoney(safeSubtotal)} />
        ) : showSubtotal ? (
          <SummaryRow
            label={showEmptyRows ? "ยอดรวมสินค้า (Subtotal)" : "รวมเป็นเงิน"}
            value={formatMoney(safeSubtotal)}
          />
        ) : null}

        {showDiscount ? (
          <SummaryRow
            label={
              discountText?.trim()
                ? `${showEmptyRows ? "ส่วนลดท้ายบิล" : "ส่วนลด"} (${discountText.trim()})`
                : showEmptyRows
                  ? "ส่วนลดท้ายบิล"
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
            label={
              extractFromGrand
                ? "มูลค่าก่อนภาษี (Vatable)"
                : "มูลค่าสินค้า/บริการ (ก่อน VAT)"
            }
            value={formatMoney(baseAmount)}
          />
        ) : null}

        {showVat ? (
          <SummaryRow label={vatLabel} value={formatMoney(vatAmount)} />
        ) : null}

        {safeShipping > 0 ? (
          <SummaryRow label={shippingLabel} value={`+${formatMoney(safeShipping)}`} />
        ) : null}

        <SummaryRow
          label={
            collectionGrandLabel?.trim() ||
            (showEmptyRows ? "ยอดสุทธิ (Grand Total)" : "ยอดสุทธิ")
          }
          value={formatMoney(safeGrand)}
          emphasize
        />
        </>
        )}

        {showWht ? (
          <>
            <SummaryRow
              label={whtRowLabel?.trim() || "หักภาษี ณ ที่จ่าย"}
              value={`−${formatMoney(safeWht)}`}
            />
            <SummaryRow
              label={netReceivedLabel?.trim() || "ยอดชำระสุทธิ"}
              value={formatMoney(
                netReceivedAmount != null && Number.isFinite(Number(netReceivedAmount))
                  ? round2(Number(netReceivedAmount))
                  : netPayable,
              )}
              emphasize
            />
          </>
        ) : null}
      </div>

      {hideBahtText ? null : (
        <p className="text-right text-[11px] font-medium leading-snug text-neutral-800">
          ({thaiBahtText})
        </p>
      )}
    </div>
  );
}
