/**
 * Refund print VAT — inherit vat_type / vat_rate from source deposit,
 * then extract Vatable + VAT from the refund grand total (Revenue Dept).
 */

import { createSupabaseServerClient } from "@/lib/supabase-server";
import { isRefundDocType } from "@/lib/constants/document";
import type { PrintVatType } from "@/types/print-document";

export function normalizePrintVatType(
  value: string | null | undefined,
): PrintVatType {
  if (value === "INCLUSIVE" || value === "EXCLUSIVE" || value === "NONE") {
    return value;
  }
  return "NONE";
}

export function resolveRefundInheritedVat(input: {
  vatType?: string | null;
  vatRate?: number | null;
  taxRate?: number | null;
  sourceVatType?: string | null;
  sourceVatRate?: number | null;
}): { vatType: PrintVatType; vatRate: number } {
  const headerType = normalizePrintVatType(input.vatType);
  const headerRateRaw = Number(input.vatRate ?? input.taxRate ?? 0);
  const headerRate = Number.isFinite(headerRateRaw) ? headerRateRaw : 0;

  if (headerType !== "NONE" && headerRate > 0) {
    return { vatType: headerType, vatRate: headerRate };
  }

  const sourceType = normalizePrintVatType(input.sourceVatType);
  const sourceRateRaw = Number(input.sourceVatRate ?? 0);
  const sourceRate = Number.isFinite(sourceRateRaw) ? sourceRateRaw : 0;
  if (sourceType !== "NONE" && sourceRate > 0) {
    return { vatType: sourceType, vatRate: sourceRate };
  }

  if (headerType !== "NONE") {
    return { vatType: headerType, vatRate: headerRate > 0 ? headerRate : 7 };
  }

  return { vatType: "NONE", vatRate: 0 };
}

/**
 * โหลด vat_type / vat_rate จากบิลมัดจำต้นทาง (DEP_IN / DEP_OUT)
 * เมื่อ header ใบ Refund ยังไม่มีค่าสืบทอด
 */
export async function loadSourceDepositVat(
  sourceDocIds: Array<string | null | undefined>,
): Promise<{ vatType: string | null; vatRate: number | null } | null> {
  const ids = [
    ...new Set(
      sourceDocIds.map((id) => String(id ?? "").trim()).filter(Boolean),
    ),
  ];
  if (ids.length === 0) return null;

  try {
    const supabase = createSupabaseServerClient();
    const { data, error } = await supabase
      .from("documents")
      .select("id, vat_type, vat_rate, tax_rate")
      .in("id", ids);

    if (error || !data || data.length === 0) return null;

    for (const row of data) {
      const vatType = String(row.vat_type ?? "").trim();
      const vatRate = Number(row.vat_rate ?? row.tax_rate ?? 0);
      if (vatType && vatType !== "NONE" && Number.isFinite(vatRate) && vatRate > 0) {
        return { vatType, vatRate };
      }
    }

    const first = data[0];
    return {
      vatType: first?.vat_type != null ? String(first.vat_type) : null,
      vatRate: Number(first?.vat_rate ?? first?.tax_rate ?? 0) || null,
    };
  } catch {
    return null;
  }
}

export { isRefundDocType };
