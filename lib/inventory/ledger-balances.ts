/**
 * On-hand quantity from inventory_ledger (Σ signed qty).
 * Server Actions only — uses admin client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";

function toQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n;
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
    const rpc = await supabase.rpc("get_on_hand_qty_by_product_ids", {
      p_product_ids: chunk,
    });

    if (!rpc.error) {
      const rows = (rpc.data ?? []) as Array<{
        product_id: string;
        on_hand_qty: number | string | null;
      }>;
      for (const row of rows) {
        const pid = String(row.product_id);
        if (!balances.has(pid)) continue;
        balances.set(pid, toQty(row.on_hand_qty));
      }
      continue;
    }

    const page = await fetchAllPages<{
      product_id: string;
      qty: number | string | null;
      trans_type: string | null;
    }>((from, to) =>
      supabase
        .from("inventory_ledger")
        .select("product_id, qty, trans_type")
        .in("product_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    );

    if (page.error) {
      return {
        balances,
        error:
          page.error.message ||
          rpc.error.message ||
          "ดึงยอดคงเหลือจาก inventory_ledger ไม่สำเร็จ",
      };
    }

    for (const row of page.data) {
      const pid = String(row.product_id);
      const signed = signedLedgerQty(row.trans_type, toQty(row.qty));
      balances.set(pid, (balances.get(pid) ?? 0) + signed);
    }
  }

  return { balances, error: null };
}
