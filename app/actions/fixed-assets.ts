"use server";

/**
 * Phase 14 — Fixed Asset Management Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types live in `@/types/fixed-asset`.
 *
 * NOTE: After applying Cloud SQL, regenerate Database types:
 *   npx supabase gen types typescript --project-id <PROJECT_ID> > src/types/supabase.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";
import type {
  AssetCategory,
  CreateFixedAssetInput,
  DisposeFixedAssetResult,
  FixedAssetFilters,
  FixedAssetListItem,
  FixedAssetStatus,
  GetAssetCategoriesResult,
  GetFixedAssetsResult,
  MutateFixedAssetResult,
  UpdateFixedAssetInput,
} from "@/types/fixed-asset";
import { FIXED_ASSET_STATUSES } from "@/types/fixed-asset";

const FIXED_ASSETS_PATH = "/fixed-assets";
const MST_ASSET_CATEGORIES_TABLE = "mst_asset_categories" as const;
const FIXED_ASSETS_TABLE = "fixed_assets" as const;
const POSTGRES_UNIQUE_VIOLATION = "23505";

const CATEGORY_SELECT =
  "id, category_code, category_name, useful_life_years, depreciation_method, description, is_active, created_at, updated_at" as const;

const ASSET_SELECT =
  "id, asset_code, asset_name, category_id, location, purchase_date, acquisition_cost, salvage_value, useful_life_years, status, remark, recorded_by, created_at, updated_at, mst_asset_categories!category_id(category_code, category_name)" as const;

function createSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env แล้วรีสตาร์ท next dev",
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

function revalidateFixedAssetCaches() {
  revalidatePath(FIXED_ASSETS_PATH);
  revalidatePath(FIXED_ASSETS_PATH, "layout");
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
}

function isFixedAssetStatus(value: string): value is FixedAssetStatus {
  return (FIXED_ASSET_STATUSES as readonly string[]).includes(value);
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function mapCategoryRow(row: Record<string, unknown>): AssetCategory {
  return {
    id: String(row.id ?? "").trim(),
    category_code: String(row.category_code ?? "").trim(),
    category_name: String(row.category_name ?? "").trim(),
    useful_life_years: Number(row.useful_life_years ?? 0),
    depreciation_method: String(row.depreciation_method ?? "STRAIGHT_LINE"),
    description:
      row.description == null || String(row.description).trim() === ""
        ? null
        : String(row.description).trim(),
    is_active: Boolean(row.is_active),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function mapAssetRow(row: Record<string, unknown>): FixedAssetListItem {
  const categoryJoin = row.mst_asset_categories;
  let categoryCode: string | null = null;
  let categoryName: string | null = null;

  if (categoryJoin && typeof categoryJoin === "object" && !Array.isArray(categoryJoin)) {
    const cat = categoryJoin as Record<string, unknown>;
    categoryCode =
      cat.category_code == null ? null : String(cat.category_code).trim();
    categoryName =
      cat.category_name == null ? null : String(cat.category_name).trim();
  }

  const statusRaw = String(row.status ?? "ACTIVE").trim().toUpperCase();
  const status: FixedAssetStatus = isFixedAssetStatus(statusRaw)
    ? statusRaw
    : "ACTIVE";

  return {
    id: String(row.id ?? "").trim(),
    asset_code: String(row.asset_code ?? "").trim(),
    asset_name: String(row.asset_name ?? "").trim(),
    category_id: String(row.category_id ?? "").trim(),
    category_code: categoryCode,
    category_name: categoryName,
    location:
      row.location == null || String(row.location).trim() === ""
        ? null
        : String(row.location).trim(),
    purchase_date: String(row.purchase_date ?? "").trim(),
    acquisition_cost: Number(row.acquisition_cost ?? 0),
    salvage_value: Number(row.salvage_value ?? 0),
    useful_life_years:
      row.useful_life_years == null ? null : Number(row.useful_life_years),
    status,
    remark:
      row.remark == null || String(row.remark).trim() === ""
        ? null
        : String(row.remark).trim(),
    recorded_by:
      row.recorded_by == null ? null : String(row.recorded_by).trim(),
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

function validateAssetPayload(input: {
  asset_code: string;
  asset_name: string;
  category_id: string;
  purchase_date: string;
  acquisition_cost: number;
  salvage_value: number;
  useful_life_years: number | null;
}): string | null {
  if (!input.asset_code) return "กรุณาระบุรหัสสินทรัพย์";
  if (!input.asset_name) return "กรุณาระบุชื่อทรัพย์สิน";
  if (!input.category_id) return "กรุณาเลือกหมวดหมู่";
  if (!isIsoDate(input.purchase_date)) {
    return "วันที่ซื้อไม่ถูกต้อง (รูปแบบ YYYY-MM-DD)";
  }
  if (!Number.isFinite(input.acquisition_cost) || input.acquisition_cost < 0) {
    return "ราคาทุนต้องเป็นตัวเลขที่ไม่ติดลบ";
  }
  if (!Number.isFinite(input.salvage_value) || input.salvage_value < 0) {
    return "มูลค่าซากต้องเป็นตัวเลขที่ไม่ติดลบ";
  }
  if (input.salvage_value > input.acquisition_cost) {
    return "มูลค่าซากต้องไม่เกินราคาทุน";
  }
  if (
    input.useful_life_years != null &&
    (!Number.isInteger(input.useful_life_years) ||
      input.useful_life_years <= 0 ||
      input.useful_life_years > 100)
  ) {
    return "อายุการใช้งานต้องอยู่ระหว่าง 1–100 ปี";
  }
  return null;
}

async function resolveActorUserId(): Promise<string | null> {
  try {
    const ssr = await createSupabaseSSRClient();
    const {
      data: { user },
    } = await ssr.auth.getUser();
    return user?.id ?? null;
  } catch {
    return null;
  }
}

/**
 * Read active (+ optionally inactive) asset categories from Master Data.
 */
export async function getAssetCategories(options?: {
  activeOnly?: boolean;
}): Promise<GetAssetCategoriesResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    let query = supabaseAdmin
      .from(MST_ASSET_CATEGORIES_TABLE)
      .select(CATEGORY_SELECT)
      .order("category_name", { ascending: true });

    if (options?.activeOnly !== false) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;
    if (error) {
      console.error("[getAssetCategories]", error.message, error);
      return {
        data: [],
        error: error.message ?? "ไม่สามารถดึงหมวดหมู่สินทรัพย์ได้",
      };
    }

    const rows = Array.isArray(data) ? data : [];
    return {
      data: rows
        .filter(
          (row): row is Record<string, unknown> =>
            row != null && typeof row === "object",
        )
        .map(mapCategoryRow)
        .filter((row) => Boolean(row.id)),
      error: null,
    };
  } catch (err) {
    console.error("[getAssetCategories]", err);
    return { data: [], error: "ไม่สามารถดึงหมวดหมู่สินทรัพย์ได้" };
  }
}

/**
 * List fixed assets with optional URL-driven search + status filter.
 */
export async function getFixedAssets(
  filters?: FixedAssetFilters,
): Promise<GetFixedAssetsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    let query = supabaseAdmin
      .from(FIXED_ASSETS_TABLE)
      .select(ASSET_SELECT)
      .order("purchase_date", { ascending: false })
      .order("asset_code", { ascending: true });

    const statusRaw = (filters?.status ?? "").trim().toUpperCase();
    if (statusRaw && statusRaw !== "ALL" && isFixedAssetStatus(statusRaw)) {
      query = query.eq("status", statusRaw);
    }

    const search = (filters?.query ?? "").trim();
    if (search) {
      const escaped = search.replace(/[%_,]/g, "\\$&");
      query = query.or(
        `asset_code.ilike.%${escaped}%,asset_name.ilike.%${escaped}%,location.ilike.%${escaped}%`,
      );
    }

    const { data, error } = await query;
    if (error) {
      console.error("[getFixedAssets]", error.message, error);
      return {
        data: [],
        error: error.message ?? "ไม่สามารถดึงรายการสินทรัพย์ถาวรได้",
      };
    }

    const rows = Array.isArray(data) ? data : [];
    return {
      data: rows
        .filter(
          (row): row is Record<string, unknown> =>
            row != null && typeof row === "object",
        )
        .map(mapAssetRow)
        .filter((row) => Boolean(row.id)),
      error: null,
    };
  } catch (err) {
    console.error("[getFixedAssets]", err);
    return { data: [], error: "ไม่สามารถดึงรายการสินทรัพย์ถาวรได้" };
  }
}

/**
 * Register a new fixed asset (Create).
 */
export async function createFixedAsset(
  input: CreateFixedAssetInput,
): Promise<MutateFixedAssetResult> {
  try {
    const asset_code = String(input.asset_code ?? "").trim().toUpperCase();
    const asset_name = String(input.asset_name ?? "").trim();
    const category_id = String(input.category_id ?? "").trim();
    const location = String(input.location ?? "").trim() || null;
    const purchase_date = String(input.purchase_date ?? "").trim();
    const acquisition_cost = roundMoney(Number(input.acquisition_cost));
    const salvage_value = roundMoney(Number(input.salvage_value ?? 0));
    const usefulLifeRaw = input.useful_life_years;
    const useful_life_years =
      usefulLifeRaw == null || String(usefulLifeRaw).trim() === ""
        ? null
        : Number(usefulLifeRaw);
    const remark = String(input.remark ?? "").trim() || null;

    const validationError = validateAssetPayload({
      asset_code,
      asset_name,
      category_id,
      purchase_date,
      acquisition_cost,
      salvage_value,
      useful_life_years:
        useful_life_years == null || Number.isNaN(useful_life_years)
          ? null
          : useful_life_years,
    });
    if (validationError) {
      return { success: false, error: validationError };
    }

    const supabaseAdmin = createSupabaseAdminClient();

    // Inherit useful life from category when omitted
    let resolvedLife = useful_life_years;
    if (resolvedLife == null) {
      const { data: category } = await supabaseAdmin
        .from(MST_ASSET_CATEGORIES_TABLE)
        .select("useful_life_years")
        .eq("id", category_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!category) {
        return { success: false, error: "ไม่พบหมวดหมู่สินทรัพย์ที่เลือก" };
      }
      resolvedLife = Number(
        (category as { useful_life_years?: number }).useful_life_years ?? 5,
      );
    }

    const recorded_by = await resolveActorUserId();
    const payload = {
      asset_code,
      asset_name,
      category_id,
      location,
      purchase_date,
      acquisition_cost,
      salvage_value,
      useful_life_years: resolvedLife,
      status: "ACTIVE" as const,
      remark,
      recorded_by,
    };

    const { data, error } = await supabaseAdmin
      .from(FIXED_ASSETS_TABLE)
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      if (
        error.code === POSTGRES_UNIQUE_VIOLATION ||
        /duplicate key|unique constraint/i.test(error.message ?? "")
      ) {
        return { success: false, error: "รหัสสินทรัพย์ซ้ำในระบบ" };
      }
      console.error("[createFixedAsset]", error.message, error);
      return {
        success: false,
        error: error.message ?? "ไม่สามารถลงทะเบียนสินทรัพย์ได้",
      };
    }

    const id = data?.id ? String(data.id) : null;
    if (id) {
      void logAuditTrail(FIXED_ASSETS_TABLE, id, "INSERT", null, payload).catch(
        (auditErr) => {
          console.error("[createFixedAsset][audit]", auditErr);
        },
      );
    }

    revalidateFixedAssetCaches();
    return { success: true, error: null, id };
  } catch (err) {
    console.error("[createFixedAsset]", err);
    return { success: false, error: "ไม่สามารถลงทะเบียนสินทรัพย์ได้" };
  }
}

/**
 * Update asset master fields (Edit) — Soft-edit only; no hard delete.
 */
export async function updateFixedAsset(
  input: UpdateFixedAssetInput,
): Promise<MutateFixedAssetResult> {
  try {
    const id = String(input.id ?? "").trim();
    if (!id) {
      return { success: false, error: "ไม่พบรหัสสินทรัพย์ที่ต้องการแก้ไข" };
    }

    const asset_code = String(input.asset_code ?? "").trim().toUpperCase();
    const asset_name = String(input.asset_name ?? "").trim();
    const category_id = String(input.category_id ?? "").trim();
    const location = String(input.location ?? "").trim() || null;
    const purchase_date = String(input.purchase_date ?? "").trim();
    const acquisition_cost = roundMoney(Number(input.acquisition_cost));
    const salvage_value = roundMoney(Number(input.salvage_value ?? 0));
    const usefulLifeRaw = input.useful_life_years;
    const useful_life_years =
      usefulLifeRaw == null || String(usefulLifeRaw).trim() === ""
        ? null
        : Number(usefulLifeRaw);
    const remark = String(input.remark ?? "").trim() || null;
    const statusRaw = String(input.status ?? "ACTIVE").trim().toUpperCase();
    if (!isFixedAssetStatus(statusRaw)) {
      return { success: false, error: "สถานะสินทรัพย์ไม่ถูกต้อง" };
    }

    const validationError = validateAssetPayload({
      asset_code,
      asset_name,
      category_id,
      purchase_date,
      acquisition_cost,
      salvage_value,
      useful_life_years:
        useful_life_years == null || Number.isNaN(useful_life_years)
          ? null
          : useful_life_years,
    });
    if (validationError) {
      return { success: false, error: validationError };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: existing, error: existingError } = await supabaseAdmin
      .from(FIXED_ASSETS_TABLE)
      .select(ASSET_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      console.error("[updateFixedAsset][load]", existingError.message);
      return {
        success: false,
        error: existingError.message ?? "ไม่สามารถโหลดสินทรัพย์ได้",
      };
    }
    if (!existing) {
      return { success: false, error: "ไม่พบสินทรัพย์ที่ต้องการแก้ไข" };
    }

    const payload = {
      asset_code,
      asset_name,
      category_id,
      location,
      purchase_date,
      acquisition_cost,
      salvage_value,
      useful_life_years,
      status: statusRaw,
      remark,
    };

    const { error } = await supabaseAdmin
      .from(FIXED_ASSETS_TABLE)
      .update(payload)
      .eq("id", id);

    if (error) {
      if (
        error.code === POSTGRES_UNIQUE_VIOLATION ||
        /duplicate key|unique constraint/i.test(error.message ?? "")
      ) {
        return { success: false, error: "รหัสสินทรัพย์ซ้ำในระบบ" };
      }
      console.error("[updateFixedAsset]", error.message, error);
      return {
        success: false,
        error: error.message ?? "ไม่สามารถแก้ไขสินทรัพย์ได้",
      };
    }

    void logAuditTrail(
      FIXED_ASSETS_TABLE,
      id,
      "UPDATE",
      existing as Record<string, unknown>,
      payload,
    ).catch((auditErr) => {
      console.error("[updateFixedAsset][audit]", auditErr);
    });

    revalidateFixedAssetCaches();
    return { success: true, error: null, id };
  } catch (err) {
    console.error("[updateFixedAsset]", err);
    return { success: false, error: "ไม่สามารถแก้ไขสินทรัพย์ได้" };
  }
}

/**
 * Load a single fixed asset by id (for edit sheet when list is filtered).
 */
export async function getFixedAssetById(
  assetId: string,
): Promise<{ data: FixedAssetListItem | null; error: string | null }> {
  try {
    const id = String(assetId ?? "").trim();
    if (!id) {
      return { data: null, error: "ไม่พบรหัสสินทรัพย์" };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from(FIXED_ASSETS_TABLE)
      .select(ASSET_SELECT)
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("[getFixedAssetById]", error.message, error);
      return {
        data: null,
        error: error.message ?? "ไม่สามารถโหลดสินทรัพย์ได้",
      };
    }
    if (!data || typeof data !== "object") {
      return { data: null, error: "ไม่พบสินทรัพย์" };
    }

    return {
      data: mapAssetRow(data as Record<string, unknown>),
      error: null,
    };
  } catch (err) {
    console.error("[getFixedAssetById]", err);
    return { data: null, error: "ไม่สามารถโหลดสินทรัพย์ได้" };
  }
}

/**
 * Soft-dispose asset (status → DISPOSED). Never hard-delete.
 */
export async function disposeFixedAsset(
  assetId: string,
): Promise<DisposeFixedAssetResult> {
  try {
    const id = String(assetId ?? "").trim();
    if (!id) {
      return { success: false, error: "ไม่พบรหัสสินทรัพย์" };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data: existing, error: existingError } = await supabaseAdmin
      .from(FIXED_ASSETS_TABLE)
      .select("id, asset_code, asset_name, status")
      .eq("id", id)
      .maybeSingle();

    if (existingError) {
      console.error("[disposeFixedAsset][load]", existingError.message);
      return {
        success: false,
        error: existingError.message ?? "ไม่สามารถโหลดสินทรัพย์ได้",
      };
    }
    if (!existing) {
      return { success: false, error: "ไม่พบสินทรัพย์ที่ต้องการจำหน่าย" };
    }

    const currentStatus = String(
      (existing as { status?: string }).status ?? "",
    ).toUpperCase();
    if (currentStatus === "DISPOSED") {
      return { success: false, error: "สินทรัพย์นี้ถูกจำหน่ายแล้ว" };
    }

    const { error } = await supabaseAdmin
      .from(FIXED_ASSETS_TABLE)
      .update({ status: "DISPOSED" })
      .eq("id", id);

    if (error) {
      console.error("[disposeFixedAsset]", error.message, error);
      return {
        success: false,
        error: error.message ?? "ไม่สามารถจำหน่ายสินทรัพย์ได้",
      };
    }

    void logAuditTrail(
      FIXED_ASSETS_TABLE,
      id,
      "UPDATE",
      existing as Record<string, unknown>,
      { status: "DISPOSED", audit_event: "DISPOSE" },
    ).catch((auditErr) => {
      console.error("[disposeFixedAsset][audit]", auditErr);
    });

    revalidateFixedAssetCaches();
    return { success: true, error: null };
  } catch (err) {
    console.error("[disposeFixedAsset]", err);
    return { success: false, error: "ไม่สามารถจำหน่ายสินทรัพย์ได้" };
  }
}
