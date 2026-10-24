"use server";

import { createClient } from "@supabase/supabase-js";
import { requireSessionUserId } from "@/lib/auth/current-user";
import {
  normalizeVendorCalcMode,
  type VendorCalcMode,
} from "@/lib/utils/vendor-calc-mode";

function createSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY หรือ NEXT_PUBLIC_SUPABASE_URL");
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isMissingCalcModeStore(error: { code?: string; message?: string } | null): boolean {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST202" ||
    error?.code === "42703" ||
    /save_vendor_rounding_calc_mode|rounding_calc_mode|does not exist|could not find the function|schema cache/i.test(
      message,
    )
  );
}

export async function loadVendorRoundingCalcMode(vendorId: string): Promise<{
  mode: VendorCalcMode;
  error: string | null;
}> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { mode: "LINE_2DEC", error: owner.error };
  const id = vendorId.trim();
  if (!id) return { mode: "LINE_2DEC", error: null };

  try {
    const supabase = createSupabaseAdmin();
    const { data, error } = await supabase
      .from("contacts")
      .select("rounding_calc_mode")
      .eq("id", id)
      .maybeSingle();
    if (error) {
      if (isMissingCalcModeStore(error)) return { mode: "LINE_2DEC", error: null };
      return { mode: "LINE_2DEC", error: error.message };
    }
    const row = data as { rounding_calc_mode?: string | null } | null;
    return { mode: normalizeVendorCalcMode(row?.rounding_calc_mode), error: null };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "โหลดวิธีคิดยอดผู้จำหน่ายไม่สำเร็จ";
    return { mode: "LINE_2DEC", error: message };
  }
}

export async function saveVendorRoundingCalcMode(
  vendorId: string,
  calcMode: VendorCalcMode,
): Promise<{ saved: boolean; error: string | null }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { saved: false, error: owner.error };
  const id = vendorId.trim();
  const mode = normalizeVendorCalcMode(calcMode);
  if (!id) return { saved: false, error: "ไม่พบผู้จำหน่าย" };

  try {
    const supabase = createSupabaseAdmin();
    const { error: rpcError } = await supabase.rpc("save_vendor_rounding_calc_mode", {
      p_vendor_id: id,
      p_rounding_calc_mode: mode,
    });
    if (!rpcError) return { saved: true, error: null };
    if (!isMissingCalcModeStore(rpcError)) return { saved: false, error: rpcError.message };

    const { error: updateError } = await supabase
      .from("contacts")
      .update({ rounding_calc_mode: mode } as never)
      .eq("id", id);
    if (!updateError) return { saved: true, error: null };
    if (isMissingCalcModeStore(updateError)) {
      return { saved: false, error: null };
    }
    return { saved: false, error: updateError.message };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "บันทึกวิธีคิดยอดผู้จำหน่ายไม่สำเร็จ";
    return { saved: false, error: message };
  }
}
