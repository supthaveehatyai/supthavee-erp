"use server";

/**
 * Phase 7 — Stock Card (Inventory Ledger) Server Actions.
 * Zero Client-Side Fetching: Service Role (`createClient` / supabaseAdmin) only.
 *
 * Schema mapping (actual DB → Stock Card API):
 * - created_at      → transaction_date
 * - qty             → quantity
 * - trans_type      → transaction_type (IN | OUT | ADJUST)
 * - document_no     → documents.doc_no (via notes document_id=)
 *                     หรือ doc_headers.doc_no / parse จาก notes
 */

import { createClient } from "@/lib/supabase/server-admin";

export type StockTransactionType = "IN" | "OUT" | "ADJUST" | string;

export type ProductStockCardHeader = {
  id: string;
  sku: string;
  /** ชื่อสินค้า */
  name: string;
  /** รุ่น (model_code / model name) */
  model: string | null;
  /** model UUID สำหรับ Matrix drill-up */
  modelId: string | null;
  /** brand UUID สำหรับ Brand overview drill-up */
  brandId: string | null;
  size: string | null;
  color: string | null;
};

export type StockCardMovement = {
  id: string;
  transaction_date: string;
  document_no: string | null;
  transaction_type: StockTransactionType;
  /** จำนวนตาม ledger (ค่าบวกเสมอ — ทิศทางดูจาก transaction_type) */
  quantity: number;
  /** ผลกระทบต่อยอดคงเหลือ (+IN / -OUT / ±ADJUST) */
  signed_qty: number;
  running_balance: number;
  notes: string | null;
};

export type ProductStockCardData = {
  product: ProductStockCardHeader;
  /** ยอดยกมาตั้งต้น ก่อน startDate (ไม่มี startDate = 0) */
  brought_forward: number;
  movements: StockCardMovement[];
  /** ยอดคงเหลือหลังรายการสุดท้ายในช่วง */
  closing_balance: number;
};

export type GetProductStockCardResult =
  | { success: true; data: ProductStockCardData }
  | { success: false; error: string };

/**
 * Accordion / Tree-Table payload: Model → Color → Size
 * มูลค่าสินค้าคงเหลือตาม LPP (GAAP / TFRS inventory valuation)
 */
export type StockOverviewPayload = {
  model_id: string;
  model_code: string;
  model_name: string;
  total_model_qty: number;
  /** Σ total_value — TFRS */
  total_model_value: number;
  colors: {
    color_code: string;
    color_name: string;
    total_color_qty: number;
    total_color_value: number;
    sizes: {
      product_id: string;
      size_code: string;
      sku: string;
      current_balance: number;
      /** LPP จาก products.cost_price */
      cost_price: number;
      /** current_balance × cost_price */
      total_value: number;
    }[];
  }[];
};

/** @deprecated ใช้ StockOverviewPayload */
export type StockCardModelView = StockOverviewPayload;

export type GetStockCardByModelResult =
  | { success: true; data: StockOverviewPayload }
  | { success: false; error: string };

export type StockCardModelSearchItem = {
  id: string;
  model_code: string;
  name: string;
  display_name: string;
};

export type SearchModelsForStockCardResult = {
  data: StockCardModelSearchItem[];
  error: string | null;
};

/**
 * Brand → Model → Color → Size overview (Product Master tree)
 * เรียงไซส์ด้วย sort_order จาก mst_sizes
 * แสดง size_name = mst_sizes.size_label (เช่น XL) — ไม่ใช้ size_code (ตัวอักษร SKU เช่น L)
 */
export type InventoryOverviewPayload = {
  brand_id: string;
  brand_name: string;
  total_brand_qty: number;
  models: {
    model_id: string;
    model_code: string;
    model_name: string;
    total_model_qty: number;
    colors: {
      color_code: string;
      color_name: string;
      total_color_qty: number;
      sizes: {
        product_id: string;
        /** ตัวอักษรใน SKU (เช่น L) — ไม่ใช้แสดง UI */
        size_code: string;
        /** ชื่อไซส์ที่มนุษย์อ่านได้ = mst_sizes.size_label (เช่น XL) */
        size_name: string;
        /** SKU สำหรับแสดงในตาราง (Enterprise UX) */
        sku: string;
        sort_order: number;
        current_balance: number;
        /** LPP จาก products.cost_price */
        unit_cost_price: number;
      }[];
    }[];
  }[];
};

export type GetInventoryOverviewByBrandResult =
  | { success: true; data: InventoryOverviewPayload }
  | { success: false; error: string };

/** Full dashboard: array of Brand → Model → Color → Size */
export type GetInventoryOverviewResult =
  | { success: true; data: InventoryOverviewPayload[] }
  | { success: false; error: string };

export type StockCardBrandSearchItem = {
  id: string;
  brand_code: string;
  brand_name: string;
  display_name: string;
};

export type SearchBrandsForStockCardResult = {
  data: StockCardBrandSearchItem[];
  error: string | null;
};

type ProductModelJoin = {
  id?: string | null;
  model_code?: string | null;
  name?: string | null;
  short_name?: string | null;
  brand_id?: string | null;
};

type DocHeaderJoin = {
  doc_no?: string | null;
  doc_date?: string | null;
};

type LedgerRow = {
  id: string;
  created_at: string | null;
  qty: number;
  trans_type: string;
  notes: string | null;
  doc_headers: DocHeaderJoin | DocHeaderJoin[] | null;
};

type ModelSkuRow = {
  id: string;
  sku: string;
  color: string | null;
  size: string | null;
  cost_price: number | string | null;
  is_active: boolean | null;
};

/** มูลค่าเงิน (บาท) — ปัดตามทศนิยมที่กำหนด */
function toMoney(value: unknown, digits = 2): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

/** LPP unit cost — เก็บละเอียด 4 ตำแหน่งตาม Net Cost Engine */
function toUnitCost(value: unknown): number {
  return toMoney(value, 4);
}

function unwrapJoin<T extends object>(
  value: T | T[] | null | undefined,
): T | null {
  if (!value) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function toQty(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.trunc(n);
}

function normalizeTransType(value: string | null | undefined): StockTransactionType {
  const t = String(value ?? "").trim().toUpperCase();
  if (t === "IN" || t === "OUT" || t === "ADJUST") return t;
  return t || "ADJUST";
}

/** ผลกระทบต่อสต็อก: IN +, OUT -, ADJUST ใช้ qty ตามเครื่องหมายที่บันทึก */
function signedQuantity(transType: StockTransactionType, qty: number): number {
  const abs = Math.abs(qty);
  if (transType === "IN") return abs;
  if (transType === "OUT") return -abs;
  return qty;
}

/**
 * Bangkok day bounds for timestamptz filters.
 * start → 00:00:00+07 · end exclusive next day 00:00:00+07
 */
function bangkokDayStart(dateStr: string): string | null {
  const d = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  return `${d}T00:00:00+07:00`;
}

function bangkokNextDayStart(dateStr: string): string | null {
  const d = dateStr.trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return null;
  const [y, m, day] = d.split("-").map(Number);
  if (!y || !m || !day) return null;
  // Calendar +1 day (UTC date math on Y-M-D components only)
  const next = new Date(Date.UTC(y, m - 1, day + 1));
  const yyyy = next.getUTCFullYear();
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00+07:00`;
}

/** Phase 4 document UUID embedded in sales OUT notes */
function documentIdFromNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  const m = notes.match(/document_id=([0-9a-fA-F-]{36})/);
  return m?.[1] ?? null;
}

/** ดึงเลขที่เอกสารจากข้อความ notes เมื่อไม่มี FK */
function documentNoFromNotes(notes: string | null | undefined): string | null {
  if (!notes?.trim()) return null;
  const patterns = [
    /จากเอกสาร\s+([A-Za-z0-9\-_/]+)/,
    /ยกเลิกเอกสาร\s+([A-Za-z0-9\-_/]+)/,
    /เอกสาร\s+([A-Za-z0-9\-_/]+)/,
  ];
  for (const re of patterns) {
    const m = notes.match(re);
    if (m?.[1]) return m[1];
  }
  return null;
}

function resolveDocumentNo(
  row: LedgerRow,
  docNoByDocumentId: Map<string, string>,
): string | null {
  const phase4Id = documentIdFromNotes(row.notes);
  if (phase4Id) {
    const fromDocuments = docNoByDocumentId.get(phase4Id)?.trim();
    if (fromDocuments) return fromDocuments;
  }
  const header = unwrapJoin(row.doc_headers);
  const fromHeader = header?.doc_no?.trim();
  if (fromHeader) return fromHeader;
  return documentNoFromNotes(row.notes);
}

function sumSignedQty(
  rows: Array<{ qty: number; trans_type: string }> | null | undefined,
): number {
  let total = 0;
  for (const row of rows ?? []) {
    const type = normalizeTransType(row.trans_type);
    total += signedQuantity(type, toQty(row.qty));
  }
  return total;
}

/**
 * ค้นหารุ่นสินค้า (product_models) สำหรับ Stock Card Matrix
 * Match: model_code / name / short_name (ilike), limit 15
 */
export async function searchModelsForStockCard(
  keyword: string,
): Promise<SearchModelsForStockCardResult> {
  try {
    const trimmed = keyword?.trim() ?? "";
    if (trimmed.length < 1) {
      return { data: [], error: null };
    }

    const pattern = `%${escapeIlikePattern(trimmed)}%`;
    const supabase = createClient();

    const [byCode, byName, byShort] = await Promise.all([
      supabase
        .from("product_models")
        .select("id, model_code, name, short_name, status")
        .ilike("model_code", pattern)
        .order("model_code", { ascending: true })
        .limit(15),
      supabase
        .from("product_models")
        .select("id, model_code, name, short_name, status")
        .ilike("name", pattern)
        .order("name", { ascending: true })
        .limit(15),
      supabase
        .from("product_models")
        .select("id, model_code, name, short_name, status")
        .ilike("short_name", pattern)
        .order("name", { ascending: true })
        .limit(15),
    ]);

    if (byCode.error) return { data: [], error: byCode.error.message };
    if (byName.error) return { data: [], error: byName.error.message };
    if (byShort.error) return { data: [], error: byShort.error.message };

    const byId = new Map<
      string,
      {
        id: string;
        model_code: string;
        name: string;
        short_name: string | null;
        status: string | null;
      }
    >();

    for (const row of [
      ...(byCode.data ?? []),
      ...(byName.data ?? []),
      ...(byShort.data ?? []),
    ]) {
      if (!row.id || byId.has(row.id)) continue;
      byId.set(row.id, {
        id: row.id,
        model_code: row.model_code,
        name: row.name,
        short_name: row.short_name,
        status: row.status,
      });
    }

    const items: StockCardModelSearchItem[] = [...byId.values()]
      .sort((a, b) => {
        const aActive = a.status === "ACTIVE" ? 0 : 1;
        const bActive = b.status === "ACTIVE" ? 0 : 1;
        if (aActive !== bActive) return aActive - bActive;
        return a.model_code.localeCompare(b.model_code, "th");
      })
      .slice(0, 15)
      .map((row) => ({
        id: row.id,
        model_code: row.model_code,
        name: row.name,
        display_name: [row.model_code, row.name].filter(Boolean).join(" · "),
      }));

    return { data: items, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ค้นหารุ่นสินค้าไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * ค้นหาแบรนด์สำหรับ Stock Card Brand Overview
 * Match: brand_code / brand_name (ilike), limit 15
 */
export async function searchBrandsForStockCard(
  keyword: string,
): Promise<SearchBrandsForStockCardResult> {
  try {
    const trimmed = keyword?.trim() ?? "";
    if (trimmed.length < 1) {
      return { data: [], error: null };
    }

    const pattern = `%${escapeIlikePattern(trimmed)}%`;
    const supabase = createClient();

    const [byCode, byName] = await Promise.all([
      supabase
        .from("mst_brands")
        .select("id, brand_code, brand_name, is_active")
        .ilike("brand_code", pattern)
        .order("brand_code", { ascending: true })
        .limit(15),
      supabase
        .from("mst_brands")
        .select("id, brand_code, brand_name, is_active")
        .ilike("brand_name", pattern)
        .order("brand_name", { ascending: true })
        .limit(15),
    ]);

    if (byCode.error) return { data: [], error: byCode.error.message };
    if (byName.error) return { data: [], error: byName.error.message };

    const byId = new Map<
      string,
      {
        id: string;
        brand_code: string;
        brand_name: string;
        is_active: boolean | null;
      }
    >();

    for (const row of [...(byCode.data ?? []), ...(byName.data ?? [])]) {
      if (!row.id || byId.has(row.id)) continue;
      byId.set(row.id, {
        id: row.id,
        brand_code: row.brand_code,
        brand_name: row.brand_name,
        is_active: row.is_active,
      });
    }

    const items: StockCardBrandSearchItem[] = [...byId.values()]
      .sort((a, b) => {
        const aActive = a.is_active === false ? 1 : 0;
        const bActive = b.is_active === false ? 1 : 0;
        if (aActive !== bActive) return aActive - bActive;
        return a.brand_code.localeCompare(b.brand_code, "th");
      })
      .slice(0, 15)
      .map((row) => ({
        id: row.id,
        brand_code: row.brand_code,
        brand_name: row.brand_name,
        display_name: [row.brand_code, row.brand_name]
          .filter(Boolean)
          .join(" · "),
      }));

    return { data: items, error: null };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ค้นหาแบรนด์ไม่สำเร็จ";
    return { data: [], error: message };
  }
}

/**
 * Inventory Overview Dashboard — Brand → Model → Color → Size
 *
 * - ไม่มี searchQuery → ดึงรุ่นทั้งหมด (ยกเว้น DRAFT)
 * - มี searchQuery → กรอง model_code / name / short_name
 * - JOIN brands + products + mst_sizes (เรียงไซส์ด้วย sort_order ASC เท่านั้น)
 * - Ledger history โหลดแยกผ่าน getProductStockCard เมื่อเลือก SKU
 */
export async function getInventoryOverview(
  searchQuery?: string,
): Promise<GetInventoryOverviewResult> {
  const q = searchQuery?.trim() ?? "";
  const supabase = createClient();

  type BrandJoin = {
    id: string;
    brand_code: string;
    brand_name: string;
  };

  type ModelRow = {
    id: string;
    model_code: string;
    name: string;
    short_name: string | null;
    status: string | null;
    brand_id: string | null;
    mst_brands: BrandJoin | BrandJoin[] | null;
  };

  const modelSelect = `
    id,
    model_code,
    name,
    short_name,
    status,
    brand_id,
    mst_brands (
      id,
      brand_code,
      brand_name
    )
  `;

  let modelRows: ModelRow[] = [];

  if (q) {
    const pattern = `%${escapeIlikePattern(q)}%`;
    const [byCode, byName, byShort] = await Promise.all([
      supabase
        .from("product_models")
        .select(modelSelect)
        .ilike("model_code", pattern)
        .order("model_code", { ascending: true }),
      supabase
        .from("product_models")
        .select(modelSelect)
        .ilike("name", pattern)
        .order("model_code", { ascending: true }),
      supabase
        .from("product_models")
        .select(modelSelect)
        .ilike("short_name", pattern)
        .order("model_code", { ascending: true }),
    ]);

    if (byCode.error) {
      return { success: false, error: byCode.error.message };
    }
    if (byName.error) {
      return { success: false, error: byName.error.message };
    }
    if (byShort.error) {
      return { success: false, error: byShort.error.message };
    }

    const byId = new Map<string, ModelRow>();
    for (const row of [
      ...((byCode.data ?? []) as ModelRow[]),
      ...((byName.data ?? []) as ModelRow[]),
      ...((byShort.data ?? []) as ModelRow[]),
    ]) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
    modelRows = [...byId.values()];
  } else {
    const { data, error: modelError } = await supabase
      .from("product_models")
      .select(modelSelect)
      .order("model_code", { ascending: true });

    if (modelError) {
      return {
        success: false,
        error: modelError.message ?? "ดึงรายการรุ่นสินค้าไม่สำเร็จ",
      };
    }
    modelRows = (data ?? []) as ModelRow[];
  }

  const models = modelRows.filter(
    (row) => row.status !== "DRAFT" && row.brand_id,
  );

  if (models.length === 0) {
    return { success: true, data: [] };
  }

  const modelIds = models.map((row) => row.id);

  // Join mst_sizes ในแอป (ไม่มี FK products→mst_sizes)
  // products.size เก็บ size_label (เช่น XL) — size_code เป็นตัวอักษร SKU (เช่น L)
  // แยก map label/code เพื่อไม่ให้ code ของ XL ('L') ทับ label ของไซส์ L
  const { data: allSizes, error: allSizesError } = await supabase
    .from("mst_sizes")
    .select("size_label, size_code, sort_order, brand_id")
    .order("sort_order", { ascending: true });

  if (allSizesError) {
    return {
      success: false,
      error: allSizesError.message ?? "ดึงตาราง mst_sizes ไม่สำเร็จ",
    };
  }

  type SizeMetaRow = {
    size_label: string;
    size_code: string;
    sort_order: number | null;
    brand_id: string | null;
  };

  type SizeMeta = {
    code: string;
    name: string;
    sortOrder: number;
  };

  const sizeMetaByLabel = new Map<string, SizeMeta>();
  const sizeMetaByCode = new Map<string, SizeMeta>();

  for (const row of (allSizes ?? []) as SizeMetaRow[]) {
    const label = String(row.size_label).trim();
    const code = String(row.size_code).trim();
    const meta: SizeMeta = {
      code,
      name: label || code || "—",
      sortOrder: Number(row.sort_order ?? 9999),
    };
    const scope = row.brand_id?.trim() || "GLOBAL";
    const labelKey = label.toUpperCase();
    const codeKey = code.toUpperCase();
    if (labelKey) sizeMetaByLabel.set(`${scope}::${labelKey}`, meta);
    // code เป็น fallback เท่านั้น — อย่าทับ key ที่เป็น label จริง
    if (codeKey && !sizeMetaByLabel.has(`${scope}::${codeKey}`)) {
      sizeMetaByCode.set(`${scope}::${codeKey}`, meta);
    }
  }

  function resolveSizeMeta(brandId: string, sizeRaw: string): SizeMeta {
    const key = sizeRaw.trim().toUpperCase();
    if (!key) return { code: "—", name: "—", sortOrder: 9999 };
    return (
      sizeMetaByLabel.get(`${brandId}::${key}`) ??
      sizeMetaByLabel.get(`GLOBAL::${key}`) ??
      sizeMetaByCode.get(`${brandId}::${key}`) ??
      sizeMetaByCode.get(`GLOBAL::${key}`) ?? {
        code: sizeRaw.trim() || "—",
        name: sizeRaw.trim() || "—",
        sortOrder: 9999,
      }
    );
  }

  // Supabase .in() มีขีดจำกัด — chunk หากจำเป็น
  const chunkSize = 200;
  type BrandSkuRow = ModelSkuRow & { model_id: string | null };
  const skuRows: BrandSkuRow[] = [];

  for (let i = 0; i < modelIds.length; i += chunkSize) {
    const chunk = modelIds.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("products")
      .select("id, sku, color, size, cost_price, is_active, model_id")
      .in("model_id", chunk)
      .order("sku", { ascending: true });

    if (error) {
      return {
        success: false,
        error: error.message ?? "ดึงรายการ SKU ไม่สำเร็จ",
      };
    }
    skuRows.push(...((data ?? []) as BrandSkuRow[]));
  }

  const products = skuRows.filter(
    (row) => row.is_active !== false && row.model_id,
  );

  const productIds = products.map((row) => row.id);
  const balanceByProduct = new Map<string, number>();
  for (const pid of productIds) balanceByProduct.set(pid, 0);

  for (let i = 0; i < productIds.length; i += chunkSize) {
    const chunk = productIds.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const { data: ledgerRows, error: ledgerError } = await supabase
      .from("inventory_ledger")
      .select("product_id, qty, trans_type")
      .in("product_id", chunk);

    if (ledgerError) {
      return {
        success: false,
        error: ledgerError.message ?? "คำนวณยอดคงเหลือจาก Ledger ไม่สำเร็จ",
      };
    }

    for (const row of ledgerRows ?? []) {
      const pid = String(row.product_id);
      const type = normalizeTransType(row.trans_type);
      const signed = signedQuantity(type, toQty(row.qty));
      balanceByProduct.set(pid, (balanceByProduct.get(pid) ?? 0) + signed);
    }
  }

  const colorCodes = [
    ...new Set(
      products
        .map((row) => row.color?.trim().toUpperCase() ?? "")
        .filter(Boolean),
    ),
  ];

  const colorNameByCode = new Map<string, string>();
  for (let i = 0; i < colorCodes.length; i += chunkSize) {
    const chunk = colorCodes.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("mst_colors")
      .select("color_code, color_name")
      .in("color_code", chunk);
    if (error) {
      return { success: false, error: error.message };
    }
    for (const row of data ?? []) {
      colorNameByCode.set(
        String(row.color_code).trim().toUpperCase(),
        String(row.color_name),
      );
    }
  }

  type SizeEntry =
    InventoryOverviewPayload["models"][number]["colors"][number]["sizes"][number];
  type ColorBucket = {
    color_code: string;
    color_name: string;
    sizes: SizeEntry[];
  };

  const productsByModel = new Map<string, BrandSkuRow[]>();
  for (const product of products) {
    const mid = String(product.model_id);
    const list = productsByModel.get(mid) ?? [];
    list.push(product);
    productsByModel.set(mid, list);
  }

  type BrandBucket = {
    brand_id: string;
    brand_name: string;
    brand_code: string;
    models: InventoryOverviewPayload["models"];
  };

  const brandMap = new Map<string, BrandBucket>();

  for (const model of models) {
    const brand = unwrapJoin(model.mst_brands);
    const brandId = brand?.id || model.brand_id;
    if (!brandId) continue;

    let brandBucket = brandMap.get(brandId);
    if (!brandBucket) {
      brandBucket = {
        brand_id: brandId,
        brand_name: brand?.brand_name || brand?.brand_code || "ไม่ระบุแบรนด์",
        brand_code: brand?.brand_code || "",
        models: [],
      };
      brandMap.set(brandId, brandBucket);
    }

    const modelProducts = productsByModel.get(model.id) ?? [];
    const colorMap = new Map<string, ColorBucket>();

    for (const product of modelProducts) {
      const colorCode = product.color?.trim().toUpperCase() || "—";
      const sizeRaw = product.size?.trim() || "—";
      const sizeMeta = resolveSizeMeta(brandId, sizeRaw);
      const currentBalance = balanceByProduct.get(product.id) ?? 0;
      const unitCostPrice = toUnitCost(product.cost_price);

      let colorBucket = colorMap.get(colorCode);
      if (!colorBucket) {
        colorBucket = {
          color_code: colorCode,
          color_name: colorNameByCode.get(colorCode) ?? colorCode,
          sizes: [],
        };
        colorMap.set(colorCode, colorBucket);
      }

      colorBucket.sizes.push({
        product_id: product.id,
        size_code: sizeMeta.code,
        size_name: sizeMeta.name,
        sku: product.sku,
        sort_order: sizeMeta.sortOrder,
        current_balance: currentBalance,
        unit_cost_price: unitCostPrice,
      });
    }

    const colors = [...colorMap.values()]
      .map((bucket) => {
        // Explicit sort — ไม่พึ่ง SQL ORDER BY หลัง grouping
        const sizes = [...bucket.sizes].sort(
          (a, b) => a.sort_order - b.sort_order,
        );
        const totalColorQty = sizes.reduce(
          (sum, size) => sum + size.current_balance,
          0,
        );
        return {
          color_code: bucket.color_code,
          color_name: bucket.color_name,
          total_color_qty: totalColorQty,
          sizes,
        };
      })
      .sort((a, b) => a.color_code.localeCompare(b.color_code, "en"));

    const totalModelQty = colors.reduce(
      (sum, color) => sum + color.total_color_qty,
      0,
    );

    brandBucket.models.push({
      model_id: model.id,
      model_code: model.model_code,
      model_name: model.name || model.short_name || model.model_code,
      total_model_qty: totalModelQty,
      colors,
    });
  }

  // Final pass: บังคับเรียง sizes ทุกสีด้วย sort_order ก่อน return
  const brands: InventoryOverviewPayload[] = [...brandMap.values()]
    .map((bucket) => {
      const modelsSorted = [...bucket.models]
        .map((model) => ({
          ...model,
          colors: model.colors.map((color) => ({
            ...color,
            sizes: [...color.sizes].sort(
              (a, b) => a.sort_order - b.sort_order,
            ),
          })),
        }))
        .sort((a, b) => a.model_code.localeCompare(b.model_code, "th"));
      const totalBrandQty = modelsSorted.reduce(
        (sum, model) => sum + model.total_model_qty,
        0,
      );
      return {
        brand_id: bucket.brand_id,
        brand_name: bucket.brand_name,
        total_brand_qty: totalBrandQty,
        models: modelsSorted,
      };
    })
    .sort((a, b) => a.brand_name.localeCompare(b.brand_name, "th"));

  return { success: true, data: brands };
}

/**
 * Inventory Overview ของแบรนด์เดียว (wrapper บน getInventoryOverview)
 */
export async function getInventoryOverviewByBrand(
  brandId: string,
): Promise<GetInventoryOverviewByBrandResult> {
  const id = brandId?.trim() ?? "";
  if (!id) {
    return { success: false, error: "ไม่พบรหัสแบรนด์ (brandId)" };
  }

  const result = await getInventoryOverview();
  if (!result.success) return result;

  const brand = result.data.find((row) => row.brand_id === id);
  if (!brand) {
    return { success: false, error: "ไม่พบแบรนด์ในระบบ หรือยังไม่มีรุ่นสินค้า" };
  }

  return { success: true, data: brand };
}

/**
 * Stock Card Matrix ของรุ่น 1 ตัว — Color → Size + LPP valuation (TFRS)
 * (Ledger history โหลดแยกผ่าน getProductStockCard เมื่อเลือกไซส์)
 */
export async function getStockCardByModel(
  modelId: string,
): Promise<GetStockCardByModelResult> {
  const id = modelId?.trim() ?? "";
  if (!id) {
    return { success: false, error: "ไม่พบรหัสรุ่น (modelId)" };
  }

  const supabase = createClient();

  const { data: model, error: modelError } = await supabase
    .from("product_models")
    .select("id, model_code, name, short_name")
    .eq("id", id)
    .maybeSingle();

  if (modelError) {
    return {
      success: false,
      error: modelError.message ?? "ดึงข้อมูลรุ่นสินค้าไม่สำเร็จ",
    };
  }
  if (!model) {
    return { success: false, error: "ไม่พบรุ่นสินค้าในระบบ" };
  }

  const emptyPayload = (): StockOverviewPayload => ({
    model_id: model.id,
    model_code: model.model_code,
    model_name: model.name || model.short_name || model.model_code,
    total_model_qty: 0,
    total_model_value: 0,
    colors: [],
  });

  const { data: skuRows, error: skuError } = await supabase
    .from("products")
    .select("id, sku, color, size, cost_price, is_active")
    .eq("model_id", id)
    .order("sku", { ascending: true });

  if (skuError) {
    return {
      success: false,
      error: skuError.message ?? "ดึงรายการ SKU ของรุ่นไม่สำเร็จ",
    };
  }

  const products = ((skuRows ?? []) as ModelSkuRow[]).filter(
    (row) => row.is_active !== false,
  );

  if (products.length === 0) {
    return { success: true, data: emptyPayload() };
  }

  const productIds = products.map((row) => row.id);

  const { data: ledgerRows, error: ledgerError } = await supabase
    .from("inventory_ledger")
    .select("product_id, qty, trans_type")
    .in("product_id", productIds);

  if (ledgerError) {
    return {
      success: false,
      error: ledgerError.message ?? "คำนวณยอดคงเหลือจาก Ledger ไม่สำเร็จ",
    };
  }

  const balanceByProduct = new Map<string, number>();
  for (const pid of productIds) balanceByProduct.set(pid, 0);
  for (const row of ledgerRows ?? []) {
    const pid = String(row.product_id);
    const type = normalizeTransType(row.trans_type);
    const signed = signedQuantity(type, toQty(row.qty));
    balanceByProduct.set(pid, (balanceByProduct.get(pid) ?? 0) + signed);
  }

  const colorCodes = [
    ...new Set(
      products
        .map((row) => row.color?.trim().toUpperCase() ?? "")
        .filter(Boolean),
    ),
  ];
  const sizeLabels = [
    ...new Set(products.map((row) => row.size?.trim() ?? "").filter(Boolean)),
  ];

  type SizeMetaRow = {
    size_label: string;
    size_code: string;
    sort_order: number | null;
  };

  const [colorsResult, sizesByLabelResult, sizesByCodeResult] =
    await Promise.all([
      colorCodes.length > 0
        ? supabase
            .from("mst_colors")
            .select("color_code, color_name")
            .in("color_code", colorCodes)
        : Promise.resolve({
            data: [] as { color_code: string; color_name: string }[],
            error: null,
          }),
      sizeLabels.length > 0
        ? supabase
            .from("mst_sizes")
            .select("size_label, size_code, sort_order")
            .in("size_label", sizeLabels)
        : Promise.resolve({ data: [] as SizeMetaRow[], error: null }),
      sizeLabels.length > 0
        ? supabase
            .from("mst_sizes")
            .select("size_label, size_code, sort_order")
            .in("size_code", sizeLabels)
        : Promise.resolve({ data: [] as SizeMetaRow[], error: null }),
    ]);

  if (colorsResult.error) {
    return { success: false, error: colorsResult.error.message };
  }
  if (sizesByLabelResult.error) {
    return { success: false, error: sizesByLabelResult.error.message };
  }
  if (sizesByCodeResult.error) {
    return { success: false, error: sizesByCodeResult.error.message };
  }

  const colorNameByCode = new Map(
    (colorsResult.data ?? []).map((row) => [
      String(row.color_code).trim().toUpperCase(),
      String(row.color_name),
    ]),
  );
  const sizeMetaByKey = new Map<
    string,
    { code: string; sortOrder: number }
  >();
  for (const row of [
    ...((sizesByLabelResult.data ?? []) as SizeMetaRow[]),
    ...((sizesByCodeResult.data ?? []) as SizeMetaRow[]),
  ]) {
    const meta = {
      code: String(row.size_code),
      sortOrder: Number(row.sort_order ?? 9999),
    };
    const labelKey = String(row.size_label).trim().toUpperCase();
    const codeKey = String(row.size_code).trim().toUpperCase();
    if (labelKey) sizeMetaByKey.set(labelKey, meta);
    if (codeKey) sizeMetaByKey.set(codeKey, meta);
  }

  type SizeEntry = StockOverviewPayload["colors"][number]["sizes"][number] & {
    sortOrder: number;
  };
  type ColorBucket = {
    color_code: string;
    color_name: string;
    sizes: SizeEntry[];
  };

  const colorMap = new Map<string, ColorBucket>();

  for (const product of products) {
    const colorCode = product.color?.trim().toUpperCase() || "—";
    const sizeLabel = product.size?.trim() || "—";
    const sizeKey = sizeLabel.toUpperCase();
    const sizeMeta = sizeMetaByKey.get(sizeKey);
    const sizeCode = sizeMeta?.code || sizeLabel;
    const sortOrder = sizeMeta?.sortOrder ?? 9999;
    const currentBalance = balanceByProduct.get(product.id) ?? 0;
    const costPrice = toUnitCost(product.cost_price);
    const totalValue = toMoney(currentBalance * costPrice, 2);

    let bucket = colorMap.get(colorCode);
    if (!bucket) {
      bucket = {
        color_code: colorCode,
        color_name: colorNameByCode.get(colorCode) ?? colorCode,
        sizes: [],
      };
      colorMap.set(colorCode, bucket);
    }

    bucket.sizes.push({
      product_id: product.id,
      size_code: sizeCode,
      sku: product.sku,
      current_balance: currentBalance,
      cost_price: costPrice,
      total_value: totalValue,
      sortOrder,
    });
  }

  const colors = [...colorMap.values()]
    .map((bucket) => {
      const sizes = bucket.sizes
        .sort((a, b) => {
          if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
          return a.size_code.localeCompare(b.size_code, "th");
        })
        .map(({ sortOrder: _sort, ...size }) => size);

      const totalColorQty = sizes.reduce(
        (sum, size) => sum + size.current_balance,
        0,
      );
      const totalColorValue = toMoney(
        sizes.reduce((sum, size) => sum + size.total_value, 0),
        2,
      );

      return {
        color_code: bucket.color_code,
        color_name: bucket.color_name,
        total_color_qty: totalColorQty,
        total_color_value: totalColorValue,
        sizes,
      };
    })
    .sort((a, b) => a.color_code.localeCompare(b.color_code, "en"));

  const totalModelQty = colors.reduce(
    (sum, color) => sum + color.total_color_qty,
    0,
  );
  const totalModelValue = toMoney(
    colors.reduce((sum, color) => sum + color.total_color_value, 0),
    2,
  );

  return {
    success: true,
    data: {
      model_id: model.id,
      model_code: model.model_code,
      model_name: model.name || model.short_name || model.model_code,
      total_model_qty: totalModelQty,
      total_model_value: totalModelValue,
      colors,
    },
  };
}

/**
 * Stock Card ของสินค้า 1 ตัว — Header + ยอดยกมา + ความเคลื่อนไหว + running balance
 */
export async function getProductStockCard(
  productId: string,
  startDate?: string,
  endDate?: string,
): Promise<GetProductStockCardResult> {
  const id = productId?.trim() ?? "";
  if (!id) {
    return { success: false, error: "ไม่พบรหัสสินค้า (productId)" };
  }

  const startBound = startDate?.trim()
    ? bangkokDayStart(startDate.trim())
    : null;
  if (startDate?.trim() && !startBound) {
    return { success: false, error: "รูปแบบ startDate ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" };
  }

  const endExclusive = endDate?.trim()
    ? bangkokNextDayStart(endDate.trim())
    : null;
  if (endDate?.trim() && !endExclusive) {
    return { success: false, error: "รูปแบบ endDate ไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)" };
  }

  const supabase = createClient();

  // ── Logic 1: Product Info (Header) ──────────────────────────────────────
  const { data: product, error: productError } = await supabase
    .from("products")
    .select(
      `
      id,
      sku,
      name,
      size,
      color,
      model_id,
      product_models (
        id,
        model_code,
        name,
        short_name,
        brand_id
      )
    `,
    )
    .eq("id", id)
    .maybeSingle();

  if (productError) {
    return {
      success: false,
      error: productError.message ?? "ดึงข้อมูลสินค้าไม่สำเร็จ",
    };
  }
  if (!product) {
    return { success: false, error: "ไม่พบสินค้าในระบบ" };
  }

  const model = unwrapJoin(
    product.product_models as ProductModelJoin | ProductModelJoin[] | null,
  );
  const modelLabel =
    model?.model_code?.trim() ||
    model?.short_name?.trim() ||
    model?.name?.trim() ||
    null;
  const resolvedModelId =
    (typeof product.model_id === "string" ? product.model_id : null) ||
    model?.id ||
    null;
  const resolvedBrandId =
    typeof model?.brand_id === "string" ? model.brand_id : null;

  const header: ProductStockCardHeader = {
    id: product.id,
    sku: product.sku,
    name: product.name,
    model: modelLabel,
    modelId: resolvedModelId,
    brandId: resolvedBrandId,
    size: product.size ?? null,
    color: product.color ?? null,
  };

  // ── Logic 2: Brought Forward (ยอดยกมา) ──────────────────────────────────
  // ไม่มี startDate → ยอดยกมา = 0
  // มี startDate → SUM signed qty ของรายการที่ created_at < startDate
  let broughtForward = 0;

  if (startBound) {
    const { data: priorRows, error: priorError } = await supabase
      .from("inventory_ledger")
      .select("qty, trans_type")
      .eq("product_id", id)
      .lt("created_at", startBound);

    if (priorError) {
      return {
        success: false,
        error: priorError.message ?? "คำนวณยอดยกมาไม่สำเร็จ",
      };
    }

    broughtForward = sumSignedQty(priorRows);
  }

  // ── Logic 3: Movements ในช่วงวันที่ ──────────────────────────────────────
  let movementsQuery = supabase
    .from("inventory_ledger")
    .select(
      `
      id,
      created_at,
      qty,
      trans_type,
      notes,
      doc_headers (
        doc_no,
        doc_date
      )
    `,
    )
    .eq("product_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (startBound) {
    movementsQuery = movementsQuery.gte("created_at", startBound);
  }
  if (endExclusive) {
    movementsQuery = movementsQuery.lt("created_at", endExclusive);
  }

  const { data: ledgerRows, error: ledgerError } = await movementsQuery;

  if (ledgerError) {
    return {
      success: false,
      error: ledgerError.message ?? "ดึงรายการความเคลื่อนไหวไม่สำเร็จ",
    };
  }

  const rawMovements = (ledgerRows as LedgerRow[] | null) ?? [];

  // Enrich document_no จากตาราง documents (Phase 4) เมื่อ notes มี document_id=
  const documentIds = [
    ...new Set(
      rawMovements
        .map((row) => documentIdFromNotes(row.notes))
        .filter((value): value is string => Boolean(value)),
    ),
  ];
  const docNoByDocumentId = new Map<string, string>();
  if (documentIds.length > 0) {
    const { data: docs, error: docsError } = await supabase
      .from("documents")
      .select("id, doc_no")
      .in("id", documentIds);
    if (docsError) {
      return {
        success: false,
        error: docsError.message ?? "ดึงเลขที่เอกสาร (documents) ไม่สำเร็จ",
      };
    }
    for (const doc of docs ?? []) {
      if (doc.id && doc.doc_no) {
        docNoByDocumentId.set(doc.id, doc.doc_no);
      }
    }
  }

  // ── Logic 4: Running Balance ────────────────────────────────────────────
  let running = broughtForward;
  const movements: StockCardMovement[] = rawMovements.map((row) => {
    const transactionType = normalizeTransType(row.trans_type);
    const quantity = Math.abs(toQty(row.qty));
    const signed = signedQuantity(transactionType, toQty(row.qty));
    running += signed;

    return {
      id: row.id,
      transaction_date: row.created_at ?? "",
      document_no: resolveDocumentNo(row, docNoByDocumentId),
      transaction_type: transactionType,
      quantity,
      signed_qty: signed,
      running_balance: running,
      notes: row.notes ?? null,
    };
  });

  return {
    success: true,
    data: {
      product: header,
      brought_forward: broughtForward,
      movements,
      closing_balance: running,
    },
  };
}
