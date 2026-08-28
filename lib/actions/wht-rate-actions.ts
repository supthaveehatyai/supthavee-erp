"use server";

/**
 * Master Data — mst_wht_rates Server Actions.
 * Zero Client-Side Fetching: supabaseAdmin (Service Role) only.
 */

import { revalidatePath } from "next/cache";
import { unstable_noStore as noStore } from "next/cache";
import { requireAdmin } from "@/lib/auth/require-admin";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import type {
  GetWhtRatesResult,
  MstWhtRate,
  WhtRateActionResult,
} from "@/types/wht-rate";

const SETTINGS_PATH = "/settings/parameters";
const EXPENSE_REVALIDATE_PATHS = ["/expenses/create", "/expenses"] as const;

type WhtRateRow = {
  id: string;
  wht_name: string;
  wht_rate: number;
  is_active: boolean;
};

function mapWhtRateRow(row: WhtRateRow): MstWhtRate {
  return {
    id: row.id,
    wht_name: row.wht_name,
    wht_rate: Number(row.wht_rate),
    is_active: row.is_active,
  };
}

function revalidateWhtRatePaths(): void {
  revalidatePath(SETTINGS_PATH);
  for (const path of EXPENSE_REVALIDATE_PATHS) {
    revalidatePath(path);
  }
}

/** Active presets for Expense Form dropdown — ordered by wht_rate ASC. */
export async function getActiveWhtRates(): Promise<GetWhtRatesResult> {
  noStore();

  try {
    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("mst_wht_rates")
      .select("id, wht_name, wht_rate, is_active")
      .eq("is_active", true)
      .order("wht_rate", { ascending: true });

    if (error) {
      return { data: [], error: error.message };
    }

    return {
      data: (data ?? []).map(mapWhtRateRow),
      error: null,
    };
  } catch (err) {
    return {
      data: [],
      error:
        err instanceof Error
          ? err.message
          : "ไม่สามารถโหลดอัตราหัก ณ ที่จ่ายได้",
    };
  }
}

/** All rows for System Settings — ordered by wht_rate ASC, then name. */
export async function getAllWhtRates(): Promise<GetWhtRatesResult> {
  noStore();

  try {
    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("mst_wht_rates")
      .select("id, wht_name, wht_rate, is_active")
      .order("wht_rate", { ascending: true })
      .order("wht_name", { ascending: true });

    if (error) {
      return { data: [], error: error.message };
    }

    return {
      data: (data ?? []).map(mapWhtRateRow),
      error: null,
    };
  } catch (err) {
    return {
      data: [],
      error:
        err instanceof Error
          ? err.message
          : "ไม่สามารถโหลดรายการหัก ณ ที่จ่ายได้",
    };
  }
}

export async function createWhtRate(
  whtName: string,
  whtRate: number,
): Promise<WhtRateActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }

  const name = whtName.trim();
  if (!name) {
    return { success: false, error: "กรุณาระบุชื่อประเภทหัก ณ ที่จ่าย" };
  }

  const rate = Number(whtRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return {
      success: false,
      error: "อัตราหัก ณ ที่จ่ายต้องอยู่ระหว่าง 0–100",
    };
  }

  try {
    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("mst_wht_rates")
      .insert({
        wht_name: name,
        wht_rate: rate,
        is_active: true,
      })
      .select("id, wht_name, wht_rate, is_active")
      .single();

    if (error) {
      if (error.code === "23505") {
        return {
          success: false,
          error: "ชื่อประเภทหัก ณ ที่จ่ายนี้มีอยู่แล้ว",
        };
      }
      return { success: false, error: error.message };
    }

    revalidateWhtRatePaths();
    return { success: true, data: mapWhtRateRow(data) };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error ? err.message : "ไม่สามารถเพิ่มอัตราหัก ณ ที่จ่ายได้",
    };
  }
}

export async function setWhtRateActive(
  id: string,
  isActive: boolean,
): Promise<WhtRateActionResult> {
  const admin = await requireAdmin();
  if (!admin.ok) {
    return { success: false, error: admin.error };
  }

  const rowId = id.trim();
  if (!rowId) {
    return { success: false, error: "ไม่พบรายการที่ต้องการแก้ไข" };
  }

  try {
    const supabaseAdmin = createSupabaseAdmin();
    const { data, error } = await supabaseAdmin
      .from("mst_wht_rates")
      .update({ is_active: isActive })
      .eq("id", rowId)
      .select("id, wht_name, wht_rate, is_active")
      .single();

    if (error) {
      return { success: false, error: error.message };
    }

    revalidateWhtRatePaths();
    return { success: true, data: mapWhtRateRow(data) };
  } catch (err) {
    return {
      success: false,
      error:
        err instanceof Error
          ? err.message
          : "ไม่สามารถอัปเดตสถานะหัก ณ ที่จ่ายได้",
    };
  }
}
