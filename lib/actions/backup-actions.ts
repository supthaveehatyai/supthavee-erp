/**
 * Phase 9 / 14 — Manual Backup Server Action (Executive Dashboard).
 * Zero Client-Side Fetching: Auth Session (SSR) + Service Role for admin DB tasks.
 */

"use server";

import { exec } from "child_process";
import path from "path";
import { promisify } from "util";
import {
  isAdminRoleCode,
  parseAccessibleModules,
} from "@/lib/auth/module-access";
import { createClient as createSupabaseAdmin } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";

const execAsync = promisify(exec);

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
 * Authorization for Manual Backup:
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

export async function triggerManualBackup(): Promise<TriggerManualBackupResult> {
  let actor: BackupAuthContext;

  try {
    actor = await assertManualBackupAuthorized();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Forbidden";
    // Always surface Forbidden for auth failures (do not leak internals)
    if (message === "Forbidden" || message.toLowerCase().includes("forbidden")) {
      throw new Error("Forbidden");
    }
    throw new Error("Forbidden");
  }

  const supabaseAdmin = createSupabaseAdmin();
  const rootDir = process.cwd();
  const dbScriptPath = path.join(rootDir, "scripts", "backup", "backup-db.mjs");
  const storageScriptPath = path.join(
    rootDir,
    "scripts",
    "backup",
    "backup-storage.mjs",
  );

  try {
    try {
      await execAsync(`node "${dbScriptPath}"`, {
        cwd: rootDir,
        maxBuffer: 1024 * 1024 * 10,
      });
    } catch (dbErr: unknown) {
      const detail =
        dbErr && typeof dbErr === "object" && "stdout" in dbErr
          ? String((dbErr as { stdout?: unknown }).stdout ?? "")
          : "";
      const msg =
        dbErr instanceof Error ? dbErr.message : "DB Backup Failed";
      console.error("DB Backup Crash:", dbErr);
      return {
        success: false,
        error: `DB Backup Failed: ${detail || msg}`,
      };
    }

    try {
      await execAsync(`node "${storageScriptPath}"`, {
        cwd: rootDir,
        maxBuffer: 1024 * 1024 * 10,
      });
    } catch (storageErr: unknown) {
      const detail =
        storageErr && typeof storageErr === "object" && "stdout" in storageErr
          ? String((storageErr as { stdout?: unknown }).stdout ?? "")
          : "";
      const msg =
        storageErr instanceof Error
          ? storageErr.message
          : "Storage Backup Failed";
      console.error("Storage Backup Crash:", storageErr);
      return {
        success: false,
        error: `Storage Backup Failed: ${detail || msg}`,
      };
    }

    const { error: auditError } = await supabaseAdmin.from("audit_logs").insert({
      action: "INSERT",
      table_name: "system_backups",
      record_id: "MANUAL_BACKUP",
      changed_by: actor.userId,
      changed_by_name: actor.displayName,
      old_data: {},
      new_data: {
        event: "MANUAL_BACKUP_TRIGGERED",
        status: "SUCCESS",
        timestamp: new Date().toISOString(),
        triggered_by: actor.userId,
        triggered_by_email: actor.email,
        role_code: actor.roleCode,
      },
    });

    if (auditError) {
      console.error("Audit Log Error:", auditError);
      return {
        success: false,
        error: `Backup สำเร็จแต่เขียน Log ไม่ลง: ${auditError.message}`,
      };
    }

    return {
      success: true,
      message: "สำรองข้อมูล Database และ Storage เสร็จสมบูรณ์!",
    };
  } catch (error: unknown) {
    console.error("Critical Backup Error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Manual Backup failed",
    };
  }
}
