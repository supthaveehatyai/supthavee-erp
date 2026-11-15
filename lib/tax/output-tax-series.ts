/**
 * หมวดเอกสารภาษีขาย — ใช้ร่วมกันระหว่างพรีวิว, Excel และ Batch PDF
 * ไม่ใช่ไฟล์ `"use server"`
 */

import type { OutputTaxSeries } from "@/types/tax-ledger";

export const OUTPUT_TAX_SUB_FILTERS = [
  { value: "ALL", label: "ทั้งหมด" },
  { value: "ABB", label: "ABB" },
  { value: "INV", label: "INV" },
  { value: "CS", label: "CS" },
  { value: "DIN", label: "DIN" },
  { value: "SP", label: "SP" },
  { value: "LZ", label: "LZ" },
] as const;

export type OutputTaxSubFilter = (typeof OUTPUT_TAX_SUB_FILTERS)[number]["value"];

export const OUTPUT_TAX_EXCEL_SHEETS: ReadonlyArray<{
  key: OutputTaxSubFilter;
  name: string;
}> = [
  { key: "ALL", name: "รวมทั้งหมด" },
  { key: "ABB", name: "ABB_หน้าร้าน" },
  { key: "CS", name: "CS_ใบเสร็จใบกำกับ" },
  { key: "INV", name: "INV_ใบส่งของใบกำกับ" },
  { key: "DIN", name: "DIN_มัดจำรับ" },
  { key: "SP", name: "SP_Shopee" },
  { key: "LZ", name: "LZ_Lazada" },
];

export function parseOutputTaxSubFilter(
  value: string | null | undefined,
): OutputTaxSubFilter {
  const key = (value ?? "ALL").trim().toUpperCase();
  if (
    key === "ABB" ||
    key === "CS" ||
    key === "INV" ||
    key === "DIN" ||
    key === "SP" ||
    key === "LZ"
  ) {
    return key;
  }
  return "ALL";
}

/**
 * SP/LZ มาก่อน ABB เพราะบิลแพลตฟอร์มเก็บ doc_type = ABB แต่เลขที่ขึ้นต้น SP/LZ
 */
export function classifyOutputTaxSeries(
  docType: string,
  docNo: string,
): OutputTaxSeries {
  const type = docType.trim().toUpperCase();
  const no = docNo.trim().toUpperCase();
  if (no.startsWith("SP")) return "SP";
  if (no.startsWith("LZ")) return "LZ";
  if (type === "DEP_IN" || no.startsWith("DIN")) return "DIN";
  if (type === "CS_TAX" || no.startsWith("CS")) return "CS";
  if (type === "TAX_INV") return "INV";
  return "ABB";
}
