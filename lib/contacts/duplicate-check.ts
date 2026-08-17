/**
 * Shared duplicate-contact guard (not a Server Action).
 * Case-insensitive company_name + optional tax_id confirmation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export const DUPLICATE_CONTACT_NAME_ERROR =
  "มีชื่อผู้ติดต่อนี้ในระบบแล้ว หากหาไม่พบกรุณาตรวจสอบในสถานะ 'ระงับการใช้งาน'";

export const DUPLICATE_CONTACT_TAX_ERROR =
  "มีเลขประจำตัวผู้เสียภาษีนี้ในระบบแล้ว หากหาไม่พบกรุณาตรวจสอบในสถานะ 'ระงับการใช้งาน'";

function escapeIlikeExact(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function normalizeTaxId(raw: string): string {
  return raw.replace(/[\s-]/g, "");
}

type DuplicateRow = {
  id: string;
  company_name: string | null;
  tax_id: string | null;
  is_active: boolean | null;
};

/**
 * Returns a UI error string when a duplicate exists, otherwise null.
 * Checks inactive rows too — so users know to look under "ระงับการใช้งาน".
 */
export async function findDuplicateContactError(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  input: {
    companyName: string;
    taxId?: string | null;
    excludeId?: string | null;
  },
): Promise<string | null> {
  const companyName = input.companyName.trim();
  if (!companyName) return null;

  const excludeId = input.excludeId?.trim() || null;
  const taxIdRaw = input.taxId?.trim() || "";
  const taxIdNormalized = normalizeTaxId(taxIdRaw);

  const nameQuery = supabase
    .from("contacts")
    .select("id, company_name, tax_id, is_active")
    .ilike("company_name", escapeIlikeExact(companyName))
    .limit(5);

  const { data: nameRows, error: nameError } = excludeId
    ? await nameQuery.neq("id", excludeId)
    : await nameQuery;

  if (nameError) {
    console.error("[findDuplicateContactError:name]", nameError.message);
    return nameError.message ?? "ตรวจสอบชื่อคู่ค้าซ้ำไม่สำเร็จ";
  }

  const nameHit = ((nameRows ?? []) as DuplicateRow[]).find((row) => {
    const existing = String(row.company_name ?? "").trim();
    return existing.localeCompare(companyName, undefined, {
      sensitivity: "accent",
    }) === 0;
  });

  if (nameHit) {
    return DUPLICATE_CONTACT_NAME_ERROR;
  }

  // Seed placeholders ("-", scientific notation) are not real tax IDs
  if (!taxIdNormalized || taxIdNormalized.length < 10 || /e\+/i.test(taxIdRaw)) {
    return null;
  }

  const taxVariants = [...new Set([taxIdRaw, taxIdNormalized].filter(Boolean))];
  const taxQuery = supabase
    .from("contacts")
    .select("id, company_name, tax_id, is_active")
    .in("tax_id", taxVariants)
    .limit(5);

  const { data: taxRows, error: taxError } = excludeId
    ? await taxQuery.neq("id", excludeId)
    : await taxQuery;

  if (taxError) {
    console.error("[findDuplicateContactError:tax]", taxError.message);
    return taxError.message ?? "ตรวจสอบเลขผู้เสียภาษีซ้ำไม่สำเร็จ";
  }

  const taxHit = ((taxRows ?? []) as DuplicateRow[]).some((row) => {
    const existing = normalizeTaxId(String(row.tax_id ?? ""));
    return existing.length > 0 && existing === taxIdNormalized;
  });

  if (taxHit) {
    return DUPLICATE_CONTACT_TAX_ERROR;
  }

  return null;
}
