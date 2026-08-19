/**
 * Shared stock availability checks for inventory_ledger OUT posts.
 * Not a Server Action module — imported by document/inventory actions.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type StockOutDemandLine = {
  product_id: string;
  qty: number;
};

type ServiceJoin = {
  is_service?: boolean | null;
};

function unwrapJoin<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * Product IDs whose `product_models.is_service = true` — skip stock check / ledger OUT.
 */
export async function loadServiceProductIdSet(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
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
    const model = unwrapJoin(row.product_models as ServiceJoin | ServiceJoin[] | null);
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
  return Math.trunc(n);
}

function signedLedgerQty(transType: string | null | undefined, qty: number): number {
  const t = String(transType ?? "").trim().toUpperCase();
  if (t === "OUT") return -Math.abs(qty);
  if (t === "IN") return Math.abs(qty);
  // ADJUST / unknown — treat signed as stored qty direction
  return qty;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  productIds: string[],
): Promise<Map<string, number>> {
  const committed = new Map<string, number>();
  const ids = [...new Set(productIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return committed;

  for (const id of ids) committed.set(id, 0);

  // 1. Find all SO ISSUED documents that still need fulfillment
  //    (no active child billing doc — i.e. not yet converted to INV_DO/TAX_INV etc.)
  const { data: soDocIds, error: soError } = await supabase
    .from("documents")
    .select("id")
    .eq("doc_type", "SO")
    .eq("status", "ISSUED")
    .or("is_voided.is.null,is_voided.eq.false");

  if (soError || !soDocIds || soDocIds.length === 0) {
    return committed;
  }

  const allSoIds = soDocIds.map((d: { id: string }) => d.id);

  // 2. Exclude SOs that already have an active child document (fulfilled)
  const { data: fulfilledRows } = await supabase
    .from("documents")
    .select("ref_document_id")
    .in("ref_document_id", allSoIds)
    .not("status", "in", '("CANCELLED","VOID")');

  const fulfilledSoIds = new Set(
    (fulfilledRows ?? []).map((r: { ref_document_id: string }) =>
      String(r.ref_document_id),
    ),
  );
  const openSoIds = allSoIds.filter(
    (id: string) => !fulfilledSoIds.has(id),
  );

  if (openSoIds.length === 0) return committed;

  // 3. Sum qty from document_items for open SOs, filtered to requested product_ids
  const chunkSize = 200;
  for (let i = 0; i < openSoIds.length; i += chunkSize) {
    const chunk = openSoIds.slice(i, i + chunkSize);
    const { data: items, error: itemsError } = await supabase
      .from("document_items")
      .select("product_id, qty")
      .in("document_id", chunk)
      .in("product_id", ids);

    if (itemsError) continue;

    for (const item of items ?? []) {
      const pid = String(item.product_id);
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

  const skuById = new Map(
    ((products ?? []) as { id: string; sku: string }[]).map((p) => [
      p.id,
      p.sku,
    ]),
  );

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
