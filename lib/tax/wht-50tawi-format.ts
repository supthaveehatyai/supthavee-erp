/**
 * Pure helpers for ภ.ง.ด.50 ทวิ — safe for Client Components.
 */

import { numberToThaiBaht } from "@/lib/utils/thai-baht-text";
import type { Wht50TawiCertificateProps } from "@/components/tax/wht-50tawi-certificate";
import type { WHTReportSource } from "@/types/tax";
import type { Wht50TawiPayer, Wht50TawiPrintPayload } from "@/types/tax-wht-print";

export const WHT_50_TAWI_COPY_TITLES = [
  "ฉบับที่ 1 ( สำหรับผู้ถูกหักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี )",
  "ฉบับที่ 2 ( สำหรับผู้ถูกหักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน )",
  "ฉบับที่ 3 ( สำหรับผู้หักภาษี ณ ที่จ่าย ใช้แนบพร้อมกับแบบแสดงรายการภาษี )",
  "ฉบับที่ 4 ( สำหรับผู้หักภาษี ณ ที่จ่าย เก็บไว้เป็นหลักฐาน )",
] as const;

/** XX-XXX-XXXX-XX-XX ตามแบบฟอร์ม */
export function formatWhtTaxIdDisplay(value: string | null | undefined): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length !== 13) return digits || "- ---- ----- -- -";
  return `${digits.slice(0, 2)}-${digits.slice(2, 5)}-${digits.slice(5, 9)}-${digits.slice(9, 11)}-${digits.slice(11, 13)}`;
}

/** วันจ่ายแบบสั้น พ.ศ. เช่น 24/06/69 */
export function formatWhtPayDateShort(value: string): string {
  if (!value) return "";
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const yy = String((date.getFullYear() + 543) % 100).padStart(2, "0");
  return `${dd}/${mm}/${yy}`;
}

export function buildWht50TawiCertificateBody(
  payload: Wht50TawiPrintPayload,
  payer: Wht50TawiPayer,
): Omit<Wht50TawiCertificateProps, "copyTitle"> {
  return {
    certNo: payload.certNo,
    payDateShort: formatWhtPayDateShort(payload.payDate),
    payer: {
      name: payer.name,
      taxIdFormatted: formatWhtTaxIdDisplay(payer.taxId),
      address: payer.address,
    },
    payee: {
      name: payload.payee.name,
      taxIdFormatted: formatWhtTaxIdDisplay(payload.payee.taxId),
      address: payload.payee.address,
      entityType: payload.payee.entityType,
    },
    whtBase: payload.whtBase,
    whtAmount: payload.whtAmount,
    whtAmountText: numberToThaiBaht(payload.whtAmount),
    incomeCategoryLabel: payload.whtType,
  };
}

/** Build print URL from WHT Report row (preserves year/month). */
export function buildWht50TawiPrintHref(
  source: WHTReportSource,
  documentId: string,
  year?: number,
  month?: number,
): string {
  const params = new URLSearchParams({
    source,
    id: documentId,
  });
  if (year != null) params.set("year", String(year));
  if (month != null) params.set("month", String(month));
  return `/tax/wht-report/print-50tawi?${params.toString()}`;
}
