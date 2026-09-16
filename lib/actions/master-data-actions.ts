"use server";

/**
 * Master Data — Sizes (`mst_sizes`)
 * Service Role only. Mutations require Admin หรือโมดูล settings.
 */

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server-admin";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import {
  canAccessPath,
  isAdminRoleCode,
} from "@/lib/auth/module-access";
import {
  normalizeSizeCode,
  sizeMasterSchema,
  toggleSizeStatusSchema,
  updateSizeMasterSchema,
} from "@/lib/validations/master-size";
import type {
  CreateSizeInput,
  GetSizesResult,
  MasterSizeRow,
  MutateSizeResult,
  UpdateSizeInput,
} from "@/types/master-size";

const SIZES_PATH = "/settings/master-data/sizes";
const SIZE_COLUMNS = "id, brand_id, size_code, size_label, sort_order, is_active";
const POSTGRES_UNIQUE_VIOLATION = "23505";

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

async function requireMasterDataAccess(): Promise<
  { ok: true } | { ok: false; error: string }
> {
  const actor = await getCurrentAuthUser();
  if (!actor) {
    return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  }
  if (isAdminRoleCode(actor.roleCode)) return { ok: true };
  if (canAccessPath(SIZES_PATH, actor.accessibleModules, actor.roleCode)) {
    return { ok: true };
  }
  return { ok: false, error: "ไม่มีสิทธิ์จัดการข้อมูลไซส์" };
}

function revalidateSizePages() {
  revalidatePath(SIZES_PATH);
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

    revalidateSizePages();
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

    revalidateSizePages();
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

    revalidateSizePages();
    return { success: true, data: mapSizeRow(data as Record<string, unknown>) };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "เปลี่ยนสถานะไซส์ไม่สำเร็จ";
    return { success: false, error: message, data: null };
  }
}
