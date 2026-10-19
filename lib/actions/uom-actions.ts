"use server";

import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import {
  FALLBACK_PURCHASE_UOMS,
  resolveConversionFactor,
  type PurchaseUomOption,
} from "@/lib/utils/purchase-uom";

export type GetPurchaseUomsResult = {
  data: PurchaseUomOption[];
  error: string | null;
};

/**
 * Purchase UOM catalog from `mst_uom`, ordered by sort_order.
 */
export async function getPurchaseUoms(): Promise<GetPurchaseUomsResult> {
  try {
    const actor = await getCurrentAuthUser();
    if (!actor?.userId) {
      return { data: FALLBACK_PURCHASE_UOMS, error: "Forbidden" };
    }

    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("mst_uom")
      .select(
        "uom_code, uom_name, default_multiplier, allow_custom_multiplier, sort_order",
      )
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[getPurchaseUoms]", error);
      return {
        data: FALLBACK_PURCHASE_UOMS,
        error: error.message,
      };
    }

    const rows = (data ?? [])
      .map((row) => {
        const uom_code = String(row.uom_code ?? "").trim();
        if (!uom_code) return null;
        return {
          uom_code,
          uom_name: String(row.uom_name ?? uom_code).trim() || uom_code,
          default_multiplier: resolveConversionFactor(row.default_multiplier),
          allow_custom_multiplier: row.allow_custom_multiplier === true,
        } satisfies PurchaseUomOption;
      })
      .filter((row): row is PurchaseUomOption => row != null);

    if (rows.length === 0) {
      return { data: FALLBACK_PURCHASE_UOMS, error: null };
    }

    return { data: rows, error: null };
  } catch (error: unknown) {
    return {
      data: FALLBACK_PURCHASE_UOMS,
      error: error instanceof Error ? error.message : "โหลดหน่วยนับไม่สำเร็จ",
    };
  }
}
