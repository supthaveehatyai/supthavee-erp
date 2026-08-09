/**
 * Shared stock availability checks for inventory_ledger OUT posts.
 * Not a Server Action module — imported by document/inventory actions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type StockOutDemandLine = {
  product_id: string;
  qty: number;
};

function toQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function signedLedgerQty(transType: string | null | undefined, qty: number): number {
  const t = String(transType ?? "").trim().toUpperCase();
  if (t === "OUT") return -Math.abs(qty);
  if (t === "IN") return Math.abs(qty);
  // ADJUST / unknown — treat signed as stored qty direction
  return qty;
}

/**
 * Aggregate OUT demand and compare against on-hand (Σ ledger).
 * When `allowNegativeInventory` is true → always ok (bypass).
 * When false and any SKU has demand > available → error "สต็อกไม่เพียงพอ".
 */
export async function assertStockOutAvailability(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  lines: StockOutDemandLine[],
  allowNegativeInventory: boolean,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (allowNegativeInventory) {
    return { ok: true };
  }

  const demandByProduct = new Map<string, number>();
  for (const line of lines) {
    const productId = String(line.product_id ?? "").trim();
    const qty = toQty(line.qty);
    if (!productId || qty <= 0) continue;
    demandByProduct.set(
      productId,
      (demandByProduct.get(productId) ?? 0) + qty,
    );
  }

  if (demandByProduct.size === 0) {
    return { ok: true };
  }

  const productIds = [...demandByProduct.keys()];
  const balanceByProduct = new Map<string, number>();
  for (const id of productIds) balanceByProduct.set(id, 0);

  const chunkSize = 200;
  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);
    const { data: ledgerRows, error: ledgerError } = await supabase
      .from("inventory_ledger")
      .select("product_id, qty, trans_type")
      .in("product_id", chunk);

    if (ledgerError) {
      return {
        ok: false,
        error:
          ledgerError.message ??
          "ตรวจสอบยอดคงเหลือจาก inventory_ledger ไม่สำเร็จ",
      };
    }

    for (const row of ledgerRows ?? []) {
      const pid = String(row.product_id);
      const signed = signedLedgerQty(row.trans_type, toQty(row.qty));
      balanceByProduct.set(pid, (balanceByProduct.get(pid) ?? 0) + signed);
    }
  }

  const shortfalls: string[] = [];
  for (const [productId, demand] of demandByProduct) {
    const available = balanceByProduct.get(productId) ?? 0;
    if (demand > available) {
      shortfalls.push(productId);
    }
  }

  if (shortfalls.length === 0) {
    return { ok: true };
  }

  // Fetch SKUs for clearer error (best-effort)
  const { data: products } = await supabase
    .from("products")
    .select("id, sku")
    .in("id", shortfalls);

  const skuById = new Map(
    ((products ?? []) as { id: string; sku: string }[]).map((p) => [
      p.id,
      p.sku,
    ]),
  );

  const details = shortfalls
    .map((id) => {
      const demand = demandByProduct.get(id) ?? 0;
      const available = balanceByProduct.get(id) ?? 0;
      const sku = skuById.get(id) ?? id.slice(0, 8);
      return `${sku} (ต้องการ ${demand} มี ${available})`;
    })
    .join(", ");

  return {
    ok: false,
    error: `สต็อกไม่เพียงพอ — ${details}`,
  };
}
