"use server";

/**
 * Phase 10 — Role Permission Matrix Server Actions.
 * Zero Client-Side Fetching: supabaseAdmin (Service Role) only.
 */

import { revalidatePath } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import {
  isAdminRoleCode,
  normalizeAccessibleModules,
  parseAccessibleModules,
} from "@/lib/auth/module-access";
import { logAuditTrail } from "@/lib/supabase/auditService";
import type { Database, Json } from "@/src/types/supabase";
import type {
  AccessibleModules,
  GetRolePermissionsResult,
  RolePermissionRow,
  UpdateRolePermissionsResult,
} from "@/types/rbac";

type AdminClient = SupabaseClient<Database>;

const UNAUTHORIZED = "Unauthorized";
const USERS_PATH = "/settings/users";

function createSupabaseAdminClient(): AdminClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env แล้วรีสตาร์ท next dev",
    );
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function assertAdminActor(
  supabaseAdmin: AdminClient,
): Promise<{ ok: true; actorId: string } | { ok: false; error: string }> {
  const actor = await getCurrentAuthUser();
  if (!actor?.userId) {
    return { ok: false, error: UNAUTHORIZED };
  }

  const { data: profile, error } = await supabaseAdmin
    .from("user_profiles")
    .select("id, role_code, is_active")
    .eq("id", actor.userId)
    .maybeSingle();

  if (error || !profile) {
    return { ok: false, error: UNAUTHORIZED };
  }
  if (profile.is_active === false) {
    return { ok: false, error: UNAUTHORIZED };
  }
  if (!isAdminRoleCode(profile.role_code)) {
    return { ok: false, error: UNAUTHORIZED };
  }

  return { ok: true, actorId: actor.userId };
}

function mapRoleRow(row: {
  role_code: string;
  role_name_th: string;
  description: string | null;
  accessible_modules: unknown;
}): RolePermissionRow {
  return {
    role_code: row.role_code,
    role_name_th: row.role_name_th,
    description: row.description ?? null,
    accessible_modules: parseAccessibleModules(
      row.accessible_modules,
      row.role_code,
    ),
  };
}

/**
 * ดึง Permission Matrix จาก `app_roles.accessible_modules`.
 */
export async function getRolePermissions(): Promise<GetRolePermissionsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const gate = await assertAdminActor(supabaseAdmin);
    if (!gate.ok) {
      return { success: false, error: gate.error, data: [] };
    }

    const { data, error } = await supabaseAdmin
      .from("app_roles")
      .select("role_code, role_name_th, description, accessible_modules")
      .order("role_name_th", { ascending: true });

    if (error) {
      return { success: false, error: error.message, data: [] };
    }

    return {
      success: true,
      data: (data ?? []).map((row) => mapRoleRow(row)),
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงสิทธิ์ระดับบทบาทไม่สำเร็จ";
    return { success: false, error: message, data: [] };
  }
}

/**
 * อัปเดต `app_roles.accessible_modules` (JSONB) — Admin only.
 */
export async function updateRoleAccessibleModules(
  roleCode: string,
  modules: AccessibleModules,
): Promise<UpdateRolePermissionsResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();
    const gate = await assertAdminActor(supabaseAdmin);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const code = String(roleCode ?? "").trim();
    if (!code) {
      return { success: false, error: "ไม่พบรหัสบทบาท (role_code)" };
    }

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("app_roles")
      .select("role_code, role_name_th, accessible_modules")
      .eq("role_code", code)
      .maybeSingle();

    if (lookupError) {
      return { success: false, error: lookupError.message };
    }
    if (!existing) {
      return { success: false, error: `ไม่พบบทบาท "${code}" ใน app_roles` };
    }

    const oldModules = parseAccessibleModules(
      existing.accessible_modules,
      existing.role_code,
    );
    const nextModules = normalizeAccessibleModules(modules, existing.role_code);

    const unchanged = modulesEqual(oldModules, nextModules);
    if (unchanged) {
      return { success: true };
    }

    const { error: updateError } = await supabaseAdmin
      .from("app_roles")
      .update({
        accessible_modules: nextModules as Json,
      })
      .eq("role_code", existing.role_code);

    if (updateError) {
      return {
        success: false,
        error: updateError.message ?? "บันทึกสิทธิ์บทบาทไม่สำเร็จ",
      };
    }

    const audit = await logAuditTrail(
      "app_roles",
      existing.role_code,
      "UPDATE",
      {
        role_code: existing.role_code,
        role_name_th: existing.role_name_th,
        accessible_modules: oldModules,
      },
      {
        role_code: existing.role_code,
        role_name_th: existing.role_name_th,
        accessible_modules: nextModules,
      },
    );

    if (!audit.success) {
      return {
        success: false,
        error: `อัปเดต app_roles สำเร็จ แต่บันทึก audit_logs ไม่สำเร็จ: ${audit.error}`,
      };
    }

    revalidatePath("/", "layout");
    revalidatePath(USERS_PATH);
    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "บันทึกสิทธิ์บทบาทไม่สำเร็จ";
    return { success: false, error: message };
  }
}

function modulesEqual(
  left: AccessibleModules,
  right: AccessibleModules,
): boolean {
  return (
    left.sales === right.sales &&
    left.purchases === right.purchases &&
    left.inventory === right.inventory &&
    left.finance === right.finance &&
    left.settings === right.settings
  );
}
