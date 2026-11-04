/** Sales freight collected for the customer. VAT-exempt under Revenue Code section 81(1)(n). */

export const SALES_SHIPPING_METHODS = [
  {
    value: "VAN",
    label: "🚐 ส่งรถตู้ (ไม่มี VAT / ออกใบรับรองแทนใบเสร็จ)",
    shortLabel: "ส่งรถตู้",
  },
  {
    value: "FLASH",
    label: "⚡ Flash Express (ยกเว้น VAT - ใบเสร็จรับเงิน)",
    shortLabel: "Flash Express",
  },
  {
    value: "KERRY",
    label: "📦 Kerry Express (ยกเว้น VAT - ใบเสร็จรับเงิน)",
    shortLabel: "Kerry Express",
  },
  {
    value: "THAILAND_POST",
    label: "📮 ไปรษณีย์ไทย (ยกเว้น VAT - ใบเสร็จรับเงิน)",
    shortLabel: "ไปรษณีย์ไทย",
  },
  {
    value: "OTHER",
    label: "🚚 ขนส่งอื่นๆ (ตามจริง)",
    shortLabel: "ขนส่งอื่นๆ",
  },
] as const;

export type SalesShippingMethod = (typeof SALES_SHIPPING_METHODS)[number]["value"];

export type SalesShippingFields = {
  shipping_fee: number;
  shipping_method: SalesShippingMethod | null;
  /** EXEMPT when a fee is charged. Shipping never enters the goods VAT base. */
  shipping_vat_mode: "EXEMPT" | "NONE";
  shipping_tracking_no: string | null;
};

export function isSalesShippingMethod(value: string): value is SalesShippingMethod {
  return SALES_SHIPPING_METHODS.some((row) => row.value === value);
}

export function salesShippingMethodLabel(method: string | null | undefined): string {
  const found = SALES_SHIPPING_METHODS.find((row) => row.value === method);
  return found?.shortLabel ?? "ไม่คิด VAT";
}

export function normalizeSalesShipping(input: {
  shipping_fee?: number | null;
  shipping_method?: string | null;
  shipping_tracking_no?: string | null;
}): SalesShippingFields {
  const feeRaw = Number(input.shipping_fee ?? 0);
  const shipping_fee =
    Number.isFinite(feeRaw) && feeRaw > 0 ? Math.round(feeRaw * 100) / 100 : 0;
  const methodRaw = String(input.shipping_method ?? "").trim().toUpperCase();
  const shipping_method = isSalesShippingMethod(methodRaw) ? methodRaw : null;
  const tracking = String(input.shipping_tracking_no ?? "").trim();
  return {
    shipping_fee,
    shipping_method: shipping_fee > 0 || shipping_method ? shipping_method : null,
    shipping_vat_mode: shipping_fee > 0 ? "EXEMPT" : "NONE",
    shipping_tracking_no: tracking || null,
  };
}
