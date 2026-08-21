"use server";

/**
 * Phase 14 — Fixed Asset Management Server Actions.
 * Zero Client-Side Fetching: Service Role (`supabaseAdmin`) only.
 * Types: DTOs in `@/types/fixed-asset` · DB Rows in `@/src/types/supabase`.
 */

import { revalidatePath } from "next/cache";
import { logAuditTrail } from "@/lib/supabase/auditService";
import { createClient } from "@/lib/supabase/server-admin";
import type { Database } from "@/src/types/supabase";
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
const POSTGRES_UNIQUE_VIOLATION = "23505";

type AssetCategoryRow =
  Database["public"]["Tables"]["mst_asset_categories"]["Row"];
type FixedAssetRow = Database["public"]["Tables"]["fixed_assets"]["Row"];
type FixedAssetInsert =
  Database["public"]["Tables"]["fixed_assets"]["Insert"];
type FixedAssetUpdate =
  Database["public"]["Tables"]["fixed_assets"]["Update"];

type FixedAssetWithCategory = FixedAssetRow & {
  mst_asset_categories: Pick<
    AssetCategoryRow,
    "category_code" | "category_name"
  > | null;
};

const CATEGORY_SELECT =
  "id, category_code, category_name, useful_life_years, depreciation_rate, is_active, created_at, updated_at" as const;

const ASSET_SELECT =
  "id, asset_code, asset_name, category_id, location, acquisition_date, acquisition_cost, salvage_value, useful_life_months, status, accumulated_depreciation, net_book_value, created_at, updated_at, mst_asset_categories!category_id(category_code, category_name)" as const;

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

function yearsToMonths(years: number): number {
  return Math.max(1, Math.round(years * 12));
}

function monthsToYears(months: number): number {
  return Math.max(1, Math.round(months / 12));
}

function mapCategoryRow(row: AssetCategoryRow): AssetCategory {
  return {
    id: row.id,
    category_code: row.category_code,
    category_name: row.category_name,
    useful_life_years: Number(row.useful_life_years ?? 0),
    depreciation_rate:
      row.depreciation_rate == null ? null : Number(row.depreciation_rate),
    is_active: Boolean(row.is_active ?? true),
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? "",
  };
}

function mapAssetRow(row: FixedAssetWithCategory): FixedAssetListItem {
  const statusRaw = String(row.status ?? "ACTIVE").trim().toUpperCase();
  const status: FixedAssetStatus = isFixedAssetStatus(statusRaw)
    ? statusRaw
    : "ACTIVE";

  const usefulLifeMonths = Number(row.useful_life_months ?? 0);

  return {
    id: row.id,
    asset_code: row.asset_code,
    asset_name: row.asset_name,
    category_id: row.category_id ?? "",
    category_code: row.mst_asset_categories?.category_code ?? null,
    category_name: row.mst_asset_categories?.category_name ?? null,
    location: row.location,
    purchase_date: row.acquisition_date,
    acquisition_cost: Number(row.acquisition_cost ?? 0),
    salvage_value: Number(row.salvage_value ?? 0),
    useful_life_years:
      usefulLifeMonths > 0 ? monthsToYears(usefulLifeMonths) : null,
    useful_life_months: usefulLifeMonths,
    accumulated_depreciation: Number(row.accumulated_depreciation ?? 0),
    net_book_value: Number(row.net_book_value ?? 0),
    status,
    created_at: row.created_at ?? "",
    updated_at: row.updated_at ?? "",
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

/**
 * Read active (+ optionally inactive) asset categories from Master Data.
 */
export async function getAssetCategories(options?: {
  activeOnly?: boolean;
}): Promise<GetAssetCategoriesResult> {
  try {
    const supabaseAdmin = createClient();
    let query = supabaseAdmin
      .from("mst_asset_categories")
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

    return {
      data: (data ?? []).map(mapCategoryRow).filter((row) => Boolean(row.id)),
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
    const supabaseAdmin = createClient();
    let query = supabaseAdmin
      .from("fixed_assets")
      .select(ASSET_SELECT)
      .order("acquisition_date", { ascending: false })
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

    return {
      data: (data ?? [])
        .map((row) => mapAssetRow(row as FixedAssetWithCategory))
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

    const supabaseAdmin = createClient();

    let resolvedYears = useful_life_years;
    if (resolvedYears == null) {
      const { data: category } = await supabaseAdmin
        .from("mst_asset_categories")
        .select("useful_life_years")
        .eq("id", category_id)
        .eq("is_active", true)
        .maybeSingle();
      if (!category) {
        return { success: false, error: "ไม่พบหมวดหมู่สินทรัพย์ที่เลือก" };
      }
      resolvedYears = Number(category.useful_life_years ?? 5);
    }

    const useful_life_months = yearsToMonths(resolvedYears);
    const payload: FixedAssetInsert = {
      asset_code,
      asset_name,
      category_id,
      location,
      acquisition_date: purchase_date,
      acquisition_cost,
      salvage_value,
      useful_life_months,
      accumulated_depreciation: 0,
      net_book_value: acquisition_cost,
      status: "ACTIVE",
    };

    const { data, error } = await supabaseAdmin
      .from("fixed_assets")
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
      void logAuditTrail("fixed_assets", id, "INSERT", null, {
        ...payload,
      }).catch((auditErr) => {
        console.error("[createFixedAsset][audit]", auditErr);
      });
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

    const supabaseAdmin = createClient();
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("fixed_assets")
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

    const existingRow = existing as FixedAssetWithCategory;
    const accumulated = Number(existingRow.accumulated_depreciation ?? 0);
    const resolvedYears =
      useful_life_years == null || Number.isNaN(useful_life_years)
        ? monthsToYears(Number(existingRow.useful_life_months ?? 12))
        : useful_life_years;

    const payload: FixedAssetUpdate = {
      asset_code,
      asset_name,
      category_id,
      location,
      acquisition_date: purchase_date,
      acquisition_cost,
      salvage_value,
      useful_life_months: yearsToMonths(resolvedYears),
      net_book_value: roundMoney(Math.max(0, acquisition_cost - accumulated)),
      status: statusRaw,
    };

    const { error } = await supabaseAdmin
      .from("fixed_assets")
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
      "fixed_assets",
      id,
      "UPDATE",
      existingRow as unknown as Record<string, unknown>,
      payload as Record<string, unknown>,
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

    const supabaseAdmin = createClient();
    const { data, error } = await supabaseAdmin
      .from("fixed_assets")
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
    if (!data) {
      return { data: null, error: "ไม่พบสินทรัพย์" };
    }

    return {
      data: mapAssetRow(data as FixedAssetWithCategory),
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

    const supabaseAdmin = createClient();
    const { data: existing, error: existingError } = await supabaseAdmin
      .from("fixed_assets")
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

    const currentStatus = String(existing.status ?? "").toUpperCase();
    if (currentStatus === "DISPOSED") {
      return { success: false, error: "สินทรัพย์นี้ถูกจำหน่ายแล้ว" };
    }

    const { error } = await supabaseAdmin
      .from("fixed_assets")
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
      "fixed_assets",
      id,
      "UPDATE",
      existing as unknown as Record<string, unknown>,
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
