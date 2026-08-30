/**
 * On-hand quantity from inventory_ledger (Σ signed qty).
 * Server Actions only — uses admin client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

function toQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function signedLedgerQty(transType: string | null | undefined, qty: number): number {
  const t = String(transType ?? "").trim().toUpperCase();
  const abs = Math.abs(qty);
  if (t === "IN") return abs;
  if (t === "OUT") return -abs;
  return qty;
}

/**
 * Returns physical on-hand qty per product_id before a new IN movement.
 */
export async function fetchOnHandQtyByProductIds(
  supabase: SupabaseClient,
  productIds: string[],
): Promise<{ balances: Map<string, number>; error: string | null }> {
  const balances = new Map<string, number>();
  const uniqueIds = [...new Set(productIds.filter(Boolean))];
  for (const id of uniqueIds) balances.set(id, 0);

  if (uniqueIds.length === 0) {
    return { balances, error: null };
  }

  const chunkSize = 200;
  for (let i = 0; i < uniqueIds.length; i += chunkSize) {
    const chunk = uniqueIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("inventory_ledger")
      .select("product_id, qty, trans_type")
      .in("product_id", chunk);

    if (error) {
      return {
        balances,
        error: error.message ?? "ดึงยอดคงเหลือจาก inventory_ledger ไม่สำเร็จ",
      };
    }

    for (const row of data ?? []) {
      const pid = String(row.product_id);
      const signed = signedLedgerQty(
        row.trans_type as string,
        toQty(row.qty as number),
      );
      balances.set(pid, (balances.get(pid) ?? 0) + signed);
    }
  }

  return { balances, error: null };
}
