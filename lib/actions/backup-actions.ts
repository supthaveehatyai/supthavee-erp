/**
 * Phase 9 / 14 — Manual Backup Request Server Action (Executive Dashboard).
 * Vercel ไม่รองรับ pg_dump — บันทึกคำขอลง audit_logs เท่านั้น (Service Role ทะลุ RLS).
 * Zero Client-Side Fetching: Auth Session (SSR) + supabaseAdmin for writes.
 */

"use server";

import { revalidatePath } from "next/cache";
import {
  isAdminRoleCode,
  parseAccessibleModules,
} from "@/lib/auth/module-access";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

export type TriggerManualBackupResult = {
  success: boolean;
  message?: string;
  error?: string | null;
};

const MANUAL_BACKUP_DR_MESSAGE =
  "แจ้งเตือน: การสำรองข้อมูลระดับ Database (Disaster Recovery) ไม่สามารถรันบน Cloud ได้ กรุณารันสคริปต์ npm run backup:db และ npm run backup:storage ที่เครื่อง Server สาขาหาดใหญ่โดยตรง เพื่อความปลอดภัยของข้อมูล";

type RoleModulesJoin =
  | { accessible_modules: unknown }
  | { accessible_modules: unknown }[]
  | null;

function unwrapRoleModules(join: RoleModulesJoin): unknown {
  if (!join) return null;
  if (Array.isArray(join)) return join[0]?.accessible_modules ?? null;
  return join.accessible_modules ?? null;
}

type AuthSuccess = {
  ok: true;
  userId: string;
};

type AuthFailure = {
  ok: false;
  error: string;
};

/**
 * Authorization for Manual Backup request:
 * 1) Auth Session → user.id
 * 2) user_profiles ⋈ app_roles (Service Role)
 * 3) Allow when role is Admin OR accessible_modules.settings === true
 */
async function resolveManualBackupAuth(): Promise<AuthSuccess | AuthFailure> {
  const supabaseAuth = await createSupabaseSSRClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();

  if (authError || !user?.id) {
    return { ok: false, error: "Forbidden" };
  }

  const supabaseAdmin = createSupabaseAdmin();
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("user_profiles")
    .select(
      `
      id,
      full_name,
      email,
      role_code,
      is_active,
      app_roles!user_profiles_role_code_fkey (
        accessible_modules
      )
    `,
    )
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile) {
    return { ok: false, error: "Forbidden" };
  }

  if (profile.is_active === false) {
    return { ok: false, error: "Forbidden" };
  }

  const roleCode =
    typeof profile.role_code === "string" && profile.role_code.trim()
      ? profile.role_code.trim()
      : null;

  const modules = parseAccessibleModules(
    unwrapRoleModules(profile.app_roles as RoleModulesJoin),
    roleCode,
  );

  const isHighLevelAdmin = isAdminRoleCode(roleCode);
  const canAccessSettings = modules.settings === true;

  if (!isHighLevelAdmin && !canAccessSettings) {
    return { ok: false, error: "Forbidden" };
  }

  return { ok: true, userId: user.id };
}

/**
 * บันทึกคำขอ Manual Backup จาก Cloud ลง audit_logs (supabaseAdmin เท่านั้น)
 */
export async function triggerManualBackup(): Promise<TriggerManualBackupResult> {
  try {
    const auth = await resolveManualBackupAuth();
    if (!auth.ok) {
      return { success: false, error: auth.error };
    }

    const supabaseAdmin = createSupabaseAdmin();
    const timestamp = new Date().toISOString();

    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      // audit_logs.action เป็น ENUM (INSERT|UPDATE|DELETE) — เก็บ semantic action ใน new_data
      action: "INSERT",
      table_name: "system",
      record_id: "N/A",
      changed_by: auth.userId,
      new_data: {
        action: "MANUAL_BACKUP_REQUEST",
        status: "Requested Manual Backup via Dashboard",
        timestamp,
      },
    });

    if (auditError) {
      console.error("Audit Log Error:", auditError);
      return { success: false, error: auditError.message };
    }

    revalidatePath("/dashboard");

    return {
      success: true,
      message: MANUAL_BACKUP_DR_MESSAGE,
    };
  } catch (error: unknown) {
    console.error("Manual Backup Request Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
