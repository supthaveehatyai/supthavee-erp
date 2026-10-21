/**
 * Shared stock availability checks for inventory_ledger OUT posts.
 * Not a Server Action module — imported by document/inventory actions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchOnHandQtyByProductIds } from "@/lib/inventory/ledger-balances";
import { fetchAllPages } from "@/lib/supabase/fetch-all-pages";
import type { Database } from "@/src/types/supabase";

export type StockOutDemandLine = {
  product_id: string;
  qty: number;
};

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Product IDs whose `product_models.is_service = true` — skip stock check / ledger OUT.
 */
export async function loadServiceProductIdSet(
  supabase: SupabaseClient<Database>,
  productIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return new Set();

  const { data, error } = await supabase
    .from("products")
    .select("id, product_models!products_model_id_fkey ( is_service )")
    .in("id", ids);

  if (error) {
    console.error("[loadServiceProductIdSet]", error.message);
    return new Set();
  }

  const serviceIds = new Set<string>();
  for (const row of data ?? []) {
    const model = unwrapJoin(row.product_models);
    if (model?.is_service === true) {
      serviceIds.add(String(row.id));
    }
  }
  return serviceIds;
}

export function excludeServiceLines<T extends { product_id: string }>(
  lines: T[],
  serviceIds: Set<string>,
): T[] {
  if (serviceIds.size === 0) return lines;
  return lines.filter((line) => !serviceIds.has(line.product_id));
}

function toQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return n;
}

/* -------------------------------------------------------------------------- */
/* Soft Allocation — Committed Stock from SO (ISSUED)                         */
/* -------------------------------------------------------------------------- */

/**
 * Committed Stock = Σ qty from `document_items` where the parent `documents`
 * row has `doc_type = 'SO'` AND `status = 'ISSUED'` AND the SO has NOT yet
 * been converted to a billing doc (no active child via `ref_document_id`).
 *
 * Available Stock (ATP) = Physical Stock − Committed Stock
 */
export async function getCommittedStockByProducts(
  supabase: SupabaseClient<Database>,
  productIds: string[],
): Promise<Map<string, number>> {
  const committed = new Map<string, number>();
  const ids = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return committed;

  for (const id of ids) committed.set(id, 0);

  // 1. Find all SO ISSUED documents that still need fulfillment
  //    (no active child billing doc — i.e. not yet converted to INV_DO/TAX_INV etc.)
  const soPage = await fetchAllPages<{ id: string }>((from, to) =>
    supabase
      .from("documents")
      .select("id")
      .eq("doc_type", "SO")
      .eq("status", "ISSUED")
      .or("is_voided.is.null,is_voided.eq.false")
      .order("id", { ascending: true })
      .range(from, to),
  );

  if (soPage.error || soPage.data.length === 0) {
    return committed;
  }

  const allSoIds = soPage.data.map((row) => row.id);

  // 2. Exclude SOs that already have an active child document (fulfilled)
  const fulfilledSoIds = new Set<string>();
  const idChunk = 200;
  for (let i = 0; i < allSoIds.length; i += idChunk) {
    const chunk = allSoIds.slice(i, i + idChunk);
    const fulfilledPage = await fetchAllPages<{
      ref_document_id: string | null;
    }>((from, to) =>
      supabase
        .from("documents")
        .select("ref_document_id")
        .in("ref_document_id", chunk)
        .not("status", "in", '("CANCELLED","VOID")')
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (fulfilledPage.error) continue;
    for (const row of fulfilledPage.data) {
      if (row.ref_document_id) {
        fulfilledSoIds.add(String(row.ref_document_id));
      }
    }
  }

  const openSoIds = allSoIds.filter((id) => !fulfilledSoIds.has(id));

  if (openSoIds.length === 0) return committed;

  // 3. Sum qty from document_items for open SOs, filtered to requested product_ids
  for (let i = 0; i < openSoIds.length; i += idChunk) {
    const chunk = openSoIds.slice(i, i + idChunk);
    const itemsPage = await fetchAllPages<{
      product_id: string | null;
      qty: number | null;
    }>((from, to) =>
      supabase
        .from("document_items")
        .select("product_id, qty")
        .in("document_id", chunk)
        .in("product_id", ids)
        .order("id", { ascending: true })
        .range(from, to),
    );

    if (itemsPage.error) continue;

    for (const item of itemsPage.data) {
      const pid = String(item.product_id ?? "");
      if (!pid) continue;
      const qty = Math.abs(toQty(item.qty));
      if (qty > 0) {
        committed.set(pid, (committed.get(pid) ?? 0) + qty);
      }
    }
  }

  return committed;
}

/**
 * Aggregate OUT demand and compare against on-hand (Σ ledger).
 * When `allowNegativeInventory` is true → always ok (bypass).
 * When false and any SKU has demand > available → error "สต็อกไม่เพียงพอ".
 */
export async function assertStockOutAvailability(
  supabase: SupabaseClient<Database>,
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
  const onHand = await fetchOnHandQtyByProductIds(supabase, productIds);
  if (onHand.error) {
    return {
      ok: false,
      error: onHand.error,
    };
  }
  const balanceByProduct = onHand.balances;

  // ── Soft Allocation: deduct SO committed qty from available ──
  const committedByProduct = await getCommittedStockByProducts(
    supabase,
    productIds,
  );

  const shortfalls: string[] = [];
  for (const [productId, demand] of demandByProduct) {
    const physical = balanceByProduct.get(productId) ?? 0;
    const committed = committedByProduct.get(productId) ?? 0;
    const available = physical - committed;
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

  const skuById = new Map((products ?? []).map((p) => [p.id, p.sku]));

  const details = shortfalls
    .map((id) => {
      const demand = demandByProduct.get(id) ?? 0;
      const physical = balanceByProduct.get(id) ?? 0;
      const committed = committedByProduct.get(id) ?? 0;
      const atp = physical - committed;
      const sku = skuById.get(id) ?? id.slice(0, 8);
      return `${sku} (ต้องการ ${demand} พร้อมขาย ${atp} | คลัง ${physical} จอง SO ${committed})`;
    })
    .join(", ");

  return {
    ok: false,
    error: `สต็อกไม่เพียงพอ (ATP) — ${details}`,
  };
}
