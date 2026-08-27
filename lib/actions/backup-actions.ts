/**
 * Phase 9 / 14 — Manual Backup Request Server Action (Executive Dashboard).
 * Vercel ไม่รองรับ pg_dump / child_process backup scripts —
 * Action นี้บันทึกคำขอลง audit_logs เท่านั้น (รัน backup จริงที่ office/NAS แยกต่างหาก).
 * Zero Client-Side Fetching: Auth Session (SSR) + Service Role for admin DB tasks.
 */

"use server";

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

type RoleModulesJoin =
  | { accessible_modules: unknown }
  | { accessible_modules: unknown }[]
  | null;

function unwrapRoleModules(join: RoleModulesJoin): unknown {
  if (!join) return null;
  if (Array.isArray(join)) return join[0]?.accessible_modules ?? null;
  return join.accessible_modules ?? null;
}

type BackupAuthContext = {
  userId: string;
  email: string | null;
  displayName: string;
  roleCode: string | null;
};

/**
 * Authorization for Manual Backup request:
 * 1) Auth Session → user.id
 * 2) user_profiles ⋈ app_roles (Service Role)
 * 3) Allow when role is Admin OR accessible_modules.settings === true
 */
async function assertManualBackupAuthorized(): Promise<BackupAuthContext> {
  const supabaseAuth = await createSupabaseSSRClient();
  const {
    data: { user },
    error: authError,
  } = await supabaseAuth.auth.getUser();

  if (authError || !user?.id) {
    throw new Error("Forbidden");
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
    throw new Error("Forbidden");
  }

  if (profile.is_active === false) {
    throw new Error("Forbidden");
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
    throw new Error("Forbidden");
  }

  const displayName =
    String(profile.full_name ?? "").trim() ||
    String(profile.email ?? "").trim() ||
    user.email?.trim() ||
    "Admin";

  return {
    userId: user.id,
    email: user.email ?? profile.email ?? null,
    displayName,
    roleCode,
  };
}

/**
 * บันทึกคำขอ Manual Backup จาก Cloud ลง audit_logs เท่านั้น
 * (ไม่รัน pg_dump / backup scripts บน Vercel)
 */
export async function triggerManualBackup(): Promise<TriggerManualBackupResult> {
  let actor: BackupAuthContext;

  try {
    actor = await assertManualBackupAuthorized();
  } catch {
    throw new Error("Forbidden");
  }

  const supabaseAdmin = createSupabaseAdmin();

  try {
    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      action: "INSERT",
      table_name: "system_backups",
      record_id: "MANUAL_BACKUP",
      changed_by: actor.userId,
      changed_by_name: actor.displayName,
      old_data: {},
      new_data: {
        event: "MANUAL_BACKUP_REQUESTED",
        status: "REQUESTED",
        message:
          "ผู้ใช้กดปุ่มร้องขอการทำ Manual Backup จากระบบ Cloud",
        timestamp: new Date().toISOString(),
        triggered_by: actor.userId,
        triggered_by_email: actor.email,
        role_code: actor.roleCode,
        source: "cloud",
      },
    });

    if (auditError) {
      console.error("Audit Log Error:", auditError);
      return {
        success: false,
        error: `บันทึกคำขอ Backup ไม่สำเร็จ: ${auditError.message}`,
      };
    }

    return {
      success: true,
      message:
        "แจ้งเตือน: การสำรองข้อมูลระดับ Database (Disaster Recovery) ไม่สามารถรันบน Cloud ได้ กรุณารันสคริปต์ npm run backup:db และ npm run backup:storage ที่เครื่อง Server สาขาหาดใหญ่โดยตรง เพื่อความปลอดภัยของข้อมูล",
    };
  } catch (error: unknown) {
    console.error("Manual Backup Request Error:", error);
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "บันทึกคำขอ Manual Backup ไม่สำเร็จ",
    };
  }
}
