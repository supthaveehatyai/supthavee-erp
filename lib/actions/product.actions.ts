"use server";

/**
 * Model-First product search for Sales UI.
 * Zero Client-Side Fetching — Service Role only.
 */

import { createClient } from "@/lib/supabase/server-admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCommittedStockByProducts } from "@/lib/inventory/stock-availability";
import type {
  GetModelMatrixForSaleResult,
  ModelMatrixForSale,
  ModelMatrixSkuRow,
  ProductModelSearchItem,
  SearchProductModelsOptions,
  SearchProductModelsResult,
} from "@/types/product-sale";

/** Cloud schema มี is_manufactured / is_raw_material — generated types ฝั่ง src/ ยังไม่ครบ */
function getUntypedAdmin(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function toMoney(value: unknown): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function toQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function signedLedgerQty(
  transType: string | null | undefined,
  qty: number,
): number {
  const t = String(transType ?? "").trim().toUpperCase();
  if (t === "OUT") return -Math.abs(qty);
  if (t === "IN") return Math.abs(qty);
  return qty;
}

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  color: string | null;
  size: string | null;
  retail_price: number | string | null;
  cost_price: number | string | null;
  base_uom: string | null;
  is_active: boolean | null;
};

const MODEL_SEARCH_SELECT =
  "id, model_code, name, short_name, image_url, status, is_active, is_service, is_raw_material, is_manufactured";

type ProductModelSearchRow = {
  id: string;
  model_code: string;
  name: string;
  short_name: string | null;
  image_url: string | null;
  status: string | null;
  is_active: boolean | null;
  is_service: boolean | null;
  is_raw_material: boolean | null;
  is_manufactured: boolean | null;
};

/**
 * ค้นหารุ่นสินค้า (product_models) ด้วย name / model_code — จำกัด 10 รายการ.
 */
export async function searchProductModels(
  keyword: string,
  options?: SearchProductModelsOptions,
): Promise<SearchProductModelsResult> {
  try {
    const trimmed = keyword?.trim() ?? "";
    if (trimmed.length < 1) {
      return { success: true, data: [] };
    }

    const manufacturedOnly = options?.manufacturedOnly === true;
    const pattern = `%${escapeIlikePattern(trimmed)}%`;
    const supabase = getUntypedAdmin();

    let nameQuery = supabase
      .from("product_models")
      .select(MODEL_SEARCH_SELECT)
      .ilike("name", pattern)
      .order("name", { ascending: true })
      .limit(10);
    let codeQuery = supabase
      .from("product_models")
      .select(MODEL_SEARCH_SELECT)
      .ilike("model_code", pattern)
      .order("model_code", { ascending: true })
      .limit(10);

    if (manufacturedOnly) {
      nameQuery = nameQuery
        .eq("is_manufactured", true)
        .neq("is_raw_material", true)
        .neq("is_service", true);
      codeQuery = codeQuery
        .eq("is_manufactured", true)
        .neq("is_raw_material", true)
        .neq("is_service", true);
    }

    const [byName, byCode] = await Promise.all([nameQuery, codeQuery]);

    if (byName.error) {
      return { success: false, error: byName.error.message, data: [] };
    }
    if (byCode.error) {
      return { success: false, error: byCode.error.message, data: [] };
    }

    const byId = new Map<string, ProductModelSearchRow>();

    for (const row of [...(byName.data ?? []), ...(byCode.data ?? [])]) {
      if (!row.id || byId.has(row.id)) continue;
      if (row.is_active === false) continue;
      if (manufacturedOnly && row.is_raw_material === true) continue;
      if (manufacturedOnly && row.is_service === true) continue;
      if (manufacturedOnly && row.is_manufactured !== true) continue;
      byId.set(row.id, row as ProductModelSearchRow);
    }

    const data: ProductModelSearchItem[] = [...byId.values()]
      .sort((a, b) => {
        const aActive = a.status === "ACTIVE" || a.status == null ? 0 : 1;
        const bActive = b.status === "ACTIVE" || b.status == null ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return a.model_code.localeCompare(b.model_code, "th");
      })
      .slice(0, 10)
      .map((row) => ({
        id: row.id,
        model_code: row.model_code,
        name: row.name,
        short_name: row.short_name,
        image_url: row.image_url,
        display_name: [row.model_code, row.name].filter(Boolean).join(" · "),
        is_service: Boolean(row.is_service),
        is_manufactured: Boolean(row.is_manufactured),
      }));

    return { success: true, data };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ค้นหารุ่นสินค้าไม่สำเร็จ";
    return { success: false, error: message, data: [] };
  }
}

/**
 * ดึง Matrix SKU ของรุ่นสำหรับหน้าขาย:
 * products ของ model + ชื่อสี/ไซส์ + unit_price + stock จาก inventory_ledger
 */
export async function getModelMatrixForSale(
  modelId: string,
): Promise<GetModelMatrixForSaleResult> {
  try {
    const id = modelId?.trim() ?? "";
    if (!id) {
      return { success: false, error: "ไม่พบรหัสรุ่นสินค้า (modelId)", data: null };
    }

    const supabase = getUntypedAdmin();

    const { data: model, error: modelError } = await supabase
      .from("product_models")
      .select("id, model_code, name, short_name, image_url, is_service, is_manufactured")
      .eq("id", id)
      .maybeSingle();

    if (modelError) {
      return { success: false, error: modelError.message, data: null };
    }
    if (!model) {
      return { success: false, error: "ไม่พบรุ่นสินค้าในระบบ", data: null };
    }

    const isService = Boolean(model.is_service);
    const isManufactured = Boolean(model.is_manufactured);

    const empty: ModelMatrixForSale = {
      model_id: model.id,
      model_code: model.model_code,
      model_name: model.name || model.short_name || model.model_code,
      image_url: model.image_url,
      is_service: isService,
      is_manufactured: isManufactured,
      skus: [],
    };

    const { data: skuRows, error: skuError } = await supabase
      .from("products")
      .select(
        "id, sku, name, color, size, retail_price, cost_price, base_uom, is_active",
      )
      .eq("model_id", id)
      .order("sku", { ascending: true });

    if (skuError) {
      return { success: false, error: skuError.message, data: null };
    }

    const products = ((skuRows ?? []) as ProductRow[]).filter(
      (row) => row.is_active !== false,
    );

    if (products.length === 0) {
      return { success: true, data: empty };
    }

    const productIds = products.map((row) => row.id);
    const balanceByProduct = new Map<string, number>();
    for (const pid of productIds) balanceByProduct.set(pid, 0);

    const { data: ledgerRows, error: ledgerError } = await supabase
      .from("inventory_ledger")
      .select("product_id, qty, trans_type")
      .in("product_id", productIds);

    if (ledgerError) {
      return {
        success: false,
        error:
          ledgerError.message ??
          "คำนวณยอดคงเหลือจาก inventory_ledger ไม่สำเร็จ",
        data: null,
      };
    }

    for (const row of ledgerRows ?? []) {
      const pid = String(row.product_id);
      const signed = signedLedgerQty(row.trans_type, toQty(row.qty));
      balanceByProduct.set(pid, (balanceByProduct.get(pid) ?? 0) + signed);
    }

    const colorCodes = [
      ...new Set(
        products
          .map((row) => row.color?.trim().toUpperCase() ?? "")
          .filter(Boolean),
      ),
    ];
    const sizeKeys = [
      ...new Set(
        products.map((row) => row.size?.trim() ?? "").filter(Boolean),
      ),
    ];

    type SizeMetaRow = {
      size_label: string;
      size_code: string;
      sort_order: number | null;
    };

    const [colorsResult, sizesByLabel, sizesByCode] = await Promise.all([
      colorCodes.length > 0
        ? supabase
            .from("mst_colors")
            .select("color_code, color_name")
            .in("color_code", colorCodes)
        : Promise.resolve({
            data: [] as { color_code: string; color_name: string }[],
            error: null,
          }),
      sizeKeys.length > 0
        ? supabase
            .from("mst_sizes")
            .select("size_label, size_code, sort_order")
            .in("size_label", sizeKeys)
        : Promise.resolve({ data: [] as SizeMetaRow[], error: null }),
      sizeKeys.length > 0
        ? supabase
            .from("mst_sizes")
            .select("size_label, size_code, sort_order")
            .in("size_code", sizeKeys)
        : Promise.resolve({ data: [] as SizeMetaRow[], error: null }),
    ]);

    if (colorsResult.error) {
      return { success: false, error: colorsResult.error.message, data: null };
    }
    if (sizesByLabel.error) {
      return { success: false, error: sizesByLabel.error.message, data: null };
    }
    if (sizesByCode.error) {
      return { success: false, error: sizesByCode.error.message, data: null };
    }

    const colorNameByCode = new Map(
      (colorsResult.data ?? []).map((row) => [
        String(row.color_code).trim().toUpperCase(),
        String(row.color_name),
      ]),
    );

    const sizeMetaByKey = new Map<
      string,
      { code: string; label: string; sortOrder: number }
    >();
    for (const row of [
      ...((sizesByLabel.data ?? []) as SizeMetaRow[]),
      ...((sizesByCode.data ?? []) as SizeMetaRow[]),
    ]) {
      const meta = {
        code: String(row.size_code),
        label: String(row.size_label),
        sortOrder: Number(row.sort_order ?? 9999),
      };
      const labelKey = String(row.size_label).trim().toUpperCase();
      const codeKey = String(row.size_code).trim().toUpperCase();
      if (labelKey) sizeMetaByKey.set(labelKey, meta);
      if (codeKey) sizeMetaByKey.set(codeKey, meta);
    }

    // ── Soft Allocation: committed qty from SO (ISSUED) ──
    const committedByProduct = isService
      ? new Map<string, number>()
      : await getCommittedStockByProducts(supabase, productIds);

    const skus: ModelMatrixSkuRow[] = products.map((product) => {
      const colorCode = product.color?.trim().toUpperCase() ?? "";
      const sizeRaw = product.size?.trim() ?? "";
      const sizeKey = sizeRaw.toUpperCase();
      const sizeMeta = sizeMetaByKey.get(sizeKey);
      const physical = balanceByProduct.get(product.id) ?? 0;
      const committed = committedByProduct.get(product.id) ?? 0;

      return {
        product_id: product.id,
        sku: product.sku,
        name: product.name,
        color_code: colorCode || "—",
        color_name: colorNameByCode.get(colorCode) || colorCode || "—",
        size_code: sizeMeta?.code || sizeRaw || "—",
        size_label: sizeMeta?.label || sizeRaw || "—",
        sort_order: sizeMeta?.sortOrder ?? 9999,
        unit_price: toMoney(product.retail_price),
        cost_price: toMoney(product.cost_price),
        base_uom: product.base_uom,
        stock_balance: physical,
        committed_qty: committed,
        available_stock: physical - committed,
        is_service: isService,
      };
    });

    skus.sort((a, b) => {
      const colorCmp = a.color_name.localeCompare(b.color_name, "th");
      if (colorCmp !== 0) return colorCmp;
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return a.size_label.localeCompare(b.size_label, "th");
    });

    return {
      success: true,
      data: {
        model_id: model.id,
        model_code: model.model_code,
        model_name: model.name || model.short_name || model.model_code,
        image_url: model.image_url,
        is_service: isService,
        is_manufactured: isManufactured,
        skus,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : "ดึง Matrix สินค้าสำหรับขายไม่สำเร็จ";
    return { success: false, error: message, data: null };
  }
}
