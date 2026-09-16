"use server";

/**
 * Master Data Hub — Sizes (`mst_sizes`) + Categories (`mst_categories`)
 * Service Role only. Mutations require Admin หรือโมดูล settings.
 * Soft Delete เท่านั้น (`is_active`) — ห้าม DELETE ทิ้ง
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import {
  canAccessPath,
  isAdminRoleCode,
} from "@/lib/auth/module-access";
import {
  categoryMasterSchema,
  toggleCategoryStatusSchema,
  updateCategoryMasterSchema,
} from "@/lib/validations/master-category";
import {
  normalizeSizeCode,
  sizeMasterSchema,
  toggleSizeStatusSchema,
  updateSizeMasterSchema,
} from "@/lib/validations/master-size";
import type {
  CreateCategoryInput,
  GetCategoriesResult,
  MasterCategoryRow,
  MutateCategoryResult,
  UpdateCategoryInput,
} from "@/types/master-category";
import type {
  CreateSizeInput,
  GetSizesResult,
  MasterSizeRow,
  MutateSizeResult,
  UpdateSizeInput,
} from "@/types/master-size";

const MASTER_DATA_PATH = "/settings/master-data";
const SIZES_PATH = "/settings/master-data/sizes";
const SIZE_COLUMNS =
  "id, brand_id, size_code, size_label, sort_order, is_active";
const CATEGORY_COLUMNS =
  "*, parent:mst_categories!parent_id(id, category_code, category_name)";
const POSTGRES_UNIQUE_VIOLATION = "23505";

type CategoryParentJoin = {
  id?: string | null;
  category_code: string | null;
  category_name: string | null;
} | null;

function mapSizeRow(row: Record<string, unknown>): MasterSizeRow {
  return {
    id: String(row.id ?? ""),
    size_code: String(row.size_code ?? "").trim().toUpperCase(),
    size_label: String(row.size_label ?? "").trim(),
    sort_order: Number(row.sort_order ?? 0),
    is_active: row.is_active !== false,
    brand_id: row.brand_id == null ? null : String(row.brand_id),
  };
}

function mapCategoryRow(row: Record<string, unknown>): MasterCategoryRow {
  const parentRaw = row.parent as CategoryParentJoin | CategoryParentJoin[] | undefined;
  const parent = Array.isArray(parentRaw) ? (parentRaw[0] ?? null) : (parentRaw ?? null);
  const parentCode = parent?.category_code?.trim().toUpperCase() || null;
  const parentName = parent?.category_name?.trim() || null;

  return {
    id: String(row.id ?? ""),
    category_code: String(row.category_code ?? "").trim().toUpperCase(),
    category_name: String(row.category_name ?? "").trim(),
    parent_id: row.parent_id == null ? null : String(row.parent_id),
    is_active: row.is_active !== false,
    parent_code: parentCode,
    parent_name: parentName,
  };
}

function sortCategoriesForDisplay(
  rows: MasterCategoryRow[],
): MasterCategoryRow[] {
  const byCode = (left: MasterCategoryRow, right: MasterCategoryRow) =>
    left.category_code.localeCompare(right.category_code, "en");

  const parents = rows.filter((row) => !row.parent_id).sort(byCode);
  const children = rows.filter((row) => row.parent_id);
  const used = new Set<string>();
  const ordered: MasterCategoryRow[] = [];

  for (const parent of parents) {
    ordered.push(parent);
    const kids = children
      .filter((child) => child.parent_id === parent.id)
      .sort(byCode);
    for (const kid of kids) {
      ordered.push(kid);
      used.add(kid.id);
    }
  }

  const orphans = children.filter((child) => !used.has(child.id)).sort(byCode);
  return ordered.concat(orphans);
}

async function requireMasterDataAccess(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const actor = await getCurrentAuthUser();
  if (!actor) {
    return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  }
  if (isAdminRoleCode(actor.roleCode)) return { ok: true };
  if (canAccessPath(MASTER_DATA_PATH, actor.accessibleModules, actor.roleCode)) {
    return { ok: true };
  }
  return { ok: false, error: "ไม่มีสิทธิ์จัดการ Master Data" };
}

function revalidateMasterDataPages() {
  revalidatePath(MASTER_DATA_PATH);
  revalidatePath(SIZES_PATH);
}

async function loadCategoryById(
  id: string,
): Promise<
  | { success: true; data: MasterCategoryRow }
  | { success: false; error: string; data: null }
> {
  const supabaseAdmin = createClient();
  const { data, error } = await supabaseAdmin
    .from("mst_categories")
    .select(CATEGORY_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message, data: null };
  }
  if (!data) {
    return { success: false, error: "ไม่พบหมวดหมู่ที่ต้องการ", data: null };
  }

  return {
    success: true,
    data: mapCategoryRow(data as Record<string, unknown>),
  };
}

async function assertChildParentRules(input: {
  categoryId?: string;
  parentId: string;
  categoryCode: string;
}): Promise<string | null> {
  const supabaseAdmin = createClient();
  const { data: parentRow, error } = await supabaseAdmin
    .from("mst_categories")
    .select("id, category_code, parent_id")
    .eq("id", input.parentId)
    .maybeSingle();

  if (error) return error.message;
  if (!parentRow) return "ไม่พบหมวดหมู่หลัก (Parent Category)";
  if (parentRow.parent_id) {
    return "กรุณาเลือกหมวดหมู่หลักเท่านั้น (ห้ามเลือกหมวดหมู่ย่อยเป็นแม่)";
  }
  if (input.categoryId && parentRow.id === input.categoryId) {
    return "ไม่สามารถเลือกหมวดหมู่ตัวเองเป็นหมวดหมู่หลักได้";
  }

  const parentCode = String(parentRow.category_code ?? "")
    .trim()
    .toUpperCase();
  const expectedPrefix = parentCode.slice(0, 1);
  if (expectedPrefix && input.categoryCode.slice(0, 1) !== expectedPrefix) {
    return `รหัสหมวดหมู่ย่อยต้องขึ้นต้นด้วย "${expectedPrefix}" ตามหมวดหมู่หลัก`;
  }

  return null;
}

export async function getSizes(): Promise<GetSizesResult> {
  const gate = await requireMasterDataAccess();
  if (!gate.ok) {
    return { success: false, error: gate.error, data: [] };
  }

  try {
    const supabaseAdmin = createClient();
    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .select(SIZE_COLUMNS)
      .order("sort_order", { ascending: true })
      .order("size_code", { ascending: true });

    if (error) {
      return { success: false, error: error.message, data: [] };
    }

    return {
      success: true,
      data: ((data ?? []) as Record<string, unknown>[]).map(mapSizeRow),
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายการไซส์ไม่สำเร็จ";
    return { success: false, error: message, data: [] };
  }
}

export async function createSize(
  input: CreateSizeInput,
): Promise<MutateSizeResult> {
  const gate = await requireMasterDataAccess();
  if (!gate.ok) {
    return { success: false, error: gate.error, data: null };
  }

  const parsed = sizeMasterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลไซส์ไม่ถูกต้อง",
      data: null,
    };
  }

  const sizeCode = normalizeSizeCode(parsed.data.size_code);

  try {
    const supabaseAdmin = createClient();
    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .insert({
        brand_id: null,
        size_code: sizeCode,
        size_label: parsed.data.size_label,
        sort_order: parsed.data.sort_order,
        is_active: true,
      })
      .select(SIZE_COLUMNS)
      .single();

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? `รหัสไซส์ "${sizeCode}" มีอยู่ในระบบแล้ว`
          : (error?.message ?? "ไม่สามารถบันทึกไซส์ใหม่ได้");
      return { success: false, error: message, data: null };
    }

    revalidateMasterDataPages();
    return { success: true, data: mapSizeRow(data as Record<string, unknown>) };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "สร้างไซส์ใหม่ไม่สำเร็จ";
    return { success: false, error: message, data: null };
  }
}

export async function updateSize(
  input: UpdateSizeInput,
): Promise<MutateSizeResult> {
  const gate = await requireMasterDataAccess();
  if (!gate.ok) {
    return { success: false, error: gate.error, data: null };
  }

  const parsed = updateSizeMasterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลไซส์ไม่ถูกต้อง",
      data: null,
    };
  }

  const sizeCode = normalizeSizeCode(parsed.data.size_code);

  try {
    const supabaseAdmin = createClient();
    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .update({
        size_code: sizeCode,
        size_label: parsed.data.size_label,
        sort_order: parsed.data.sort_order,
      })
      .eq("id", parsed.data.id)
      .select(SIZE_COLUMNS)
      .single();

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? `รหัสไซส์ "${sizeCode}" มีอยู่ในระบบแล้ว`
          : (error?.message ?? "ไม่สามารถอัปเดตไซส์ได้");
      return { success: false, error: message, data: null };
    }

    revalidateMasterDataPages();
    return { success: true, data: mapSizeRow(data as Record<string, unknown>) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "อัปเดตไซส์ไม่สำเร็จ";
    return { success: false, error: message, data: null };
  }
}

export async function toggleSizeStatus(id: string): Promise<MutateSizeResult> {
  const gate = await requireMasterDataAccess();
  if (!gate.ok) {
    return { success: false, error: gate.error, data: null };
  }

  const parsed = toggleSizeStatusSchema.safeParse({ id });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "ไม่พบรหัสไซส์",
      data: null,
    };
  }

  try {
    const supabaseAdmin = createClient();
    const { data: current, error: loadError } = await supabaseAdmin
      .from("mst_sizes")
      .select(SIZE_COLUMNS)
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (loadError) {
      return { success: false, error: loadError.message, data: null };
    }
    if (!current) {
      return { success: false, error: "ไม่พบไซส์ที่ต้องการเปลี่ยนสถานะ", data: null };
    }

    const nextActive = current.is_active === false;
    const { data, error } = await supabaseAdmin
      .from("mst_sizes")
      .update({ is_active: nextActive })
      .eq("id", parsed.data.id)
      .select(SIZE_COLUMNS)
      .single();

    if (error || !data) {
      return {
        success: false,
        error: error?.message ?? "ไม่สามารถเปลี่ยนสถานะไซส์ได้",
        data: null,
      };
    }

    revalidateMasterDataPages();
    return { success: true, data: mapSizeRow(data as Record<string, unknown>) };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "เปลี่ยนสถานะไซส์ไม่สำเร็จ";
    return { success: false, error: message, data: null };
  }
}

export async function getCategories(): Promise<GetCategoriesResult> {
  const gate = await requireMasterDataAccess();
  if (!gate.ok) {
    return { success: false, error: gate.error, data: [] };
  }

  try {
    const supabaseAdmin = createClient();
    const { data, error } = await supabaseAdmin
      .from("mst_categories")
      .select(CATEGORY_COLUMNS)
      .order("category_code", { ascending: true });

    if (error) {
      return { success: false, error: error.message, data: [] };
    }

    const mapped = ((data ?? []) as Record<string, unknown>[]).map(
      mapCategoryRow,
    );

    return { success: true, data: sortCategoriesForDisplay(mapped) };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "โหลดรายการหมวดหมู่ไม่สำเร็จ";
    return { success: false, error: message, data: [] };
  }
}

export async function createCategory(
  input: CreateCategoryInput,
): Promise<MutateCategoryResult> {
  const gate = await requireMasterDataAccess();
  if (!gate.ok) {
    return { success: false, error: gate.error, data: null };
  }

  const parsed = categoryMasterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลหมวดหมู่ไม่ถูกต้อง",
      data: null,
    };
  }

  const parentId = parsed.data.kind === "child" ? parsed.data.parent_id : null;
  const categoryCode = parsed.data.category_code;

  try {
    if (parsed.data.kind === "child" && parentId) {
      const parentError = await assertChildParentRules({
        parentId,
        categoryCode,
      });
      if (parentError) {
        return { success: false, error: parentError, data: null };
      }
    }

    const supabaseAdmin = createClient();
    const { data, error } = await supabaseAdmin
      .from("mst_categories")
      .insert({
        category_code: categoryCode,
        category_name: parsed.data.category_name,
        parent_id: parentId,
        is_active: true,
      })
      .select("id")
      .single();

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? `รหัสหรือชื่อหมวดหมู่ "${categoryCode}" มีอยู่ในระบบแล้ว`
          : (error?.message ?? "ไม่สามารถบันทึกหมวดหมู่ใหม่ได้");
      return { success: false, error: message, data: null };
    }

    revalidateMasterDataPages();
    return loadCategoryById(String((data as { id: string }).id));
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "สร้างหมวดหมู่ใหม่ไม่สำเร็จ";
    return { success: false, error: message, data: null };
  }
}

export async function updateCategory(
  input: UpdateCategoryInput,
): Promise<MutateCategoryResult> {
  const gate = await requireMasterDataAccess();
  if (!gate.ok) {
    return { success: false, error: gate.error, data: null };
  }

  const parsed = updateCategoryMasterSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "ข้อมูลหมวดหมู่ไม่ถูกต้อง",
      data: null,
    };
  }

  const parentId = parsed.data.kind === "child" ? parsed.data.parent_id : null;
  const categoryCode = parsed.data.category_code;

  try {
    const supabaseAdmin = createClient();
    const { data: current, error: loadError } = await supabaseAdmin
      .from("mst_categories")
      .select("id, parent_id")
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (loadError) {
      return { success: false, error: loadError.message, data: null };
    }
    if (!current) {
      return { success: false, error: "ไม่พบหมวดหมู่ที่ต้องการแก้ไข", data: null };
    }

    if (parsed.data.kind === "child") {
      const { count, error: childCountError } = await supabaseAdmin
        .from("mst_categories")
        .select("id", { count: "exact", head: true })
        .eq("parent_id", parsed.data.id);

      if (childCountError) {
        return { success: false, error: childCountError.message, data: null };
      }
      if ((count ?? 0) > 0) {
        return {
          success: false,
          error: "ไม่สามารถเปลี่ยนเป็นหมวดหมู่ย่อยได้ เพราะมีหมวดหมู่ลูกอยู่",
          data: null,
        };
      }

      if (!parentId) {
        return { success: false, error: "กรุณาเลือกหมวดหมู่หลัก", data: null };
      }

      const parentError = await assertChildParentRules({
        categoryId: parsed.data.id,
        parentId,
        categoryCode,
      });
      if (parentError) {
        return { success: false, error: parentError, data: null };
      }
    }

    const { data, error } = await supabaseAdmin
      .from("mst_categories")
      .update({
        category_code: categoryCode,
        category_name: parsed.data.category_name,
        parent_id: parentId,
      })
      .eq("id", parsed.data.id)
      .select("id")
      .single();

    if (error || !data) {
      const message =
        error?.code === POSTGRES_UNIQUE_VIOLATION
          ? `รหัสหรือชื่อหมวดหมู่ "${categoryCode}" มีอยู่ในระบบแล้ว`
          : (error?.message ?? "ไม่สามารถอัปเดตหมวดหมู่ได้");
      return { success: false, error: message, data: null };
    }

    revalidateMasterDataPages();
    return loadCategoryById(parsed.data.id);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "อัปเดตหมวดหมู่ไม่สำเร็จ";
    return { success: false, error: message, data: null };
  }
}

export async function toggleCategoryStatus(
  id: string,
): Promise<MutateCategoryResult> {
  const gate = await requireMasterDataAccess();
  if (!gate.ok) {
    return { success: false, error: gate.error, data: null };
  }

  const parsed = toggleCategoryStatusSchema.safeParse({ id });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "ไม่พบรหัสหมวดหมู่",
      data: null,
    };
  }

  try {
    const supabaseAdmin = createClient();
    const { data: current, error: loadError } = await supabaseAdmin
      .from("mst_categories")
      .select("id, is_active")
      .eq("id", parsed.data.id)
      .maybeSingle();

    if (loadError) {
      return { success: false, error: loadError.message, data: null };
    }
    if (!current) {
      return {
        success: false,
        error: "ไม่พบหมวดหมู่ที่ต้องการเปลี่ยนสถานะ",
        data: null,
      };
    }

    const nextActive = current.is_active === false;
    const { data, error } = await supabaseAdmin
      .from("mst_categories")
      .update({ is_active: nextActive })
      .eq("id", parsed.data.id)
      .select("id")
      .single();

    if (error || !data) {
      return {
        success: false,
        error: error?.message ?? "ไม่สามารถเปลี่ยนสถานะหมวดหมู่ได้",
        data: null,
      };
    }

    revalidateMasterDataPages();
    return loadCategoryById(parsed.data.id);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "เปลี่ยนสถานะหมวดหมู่ไม่สำเร็จ";
    return { success: false, error: message, data: null };
  }
}
