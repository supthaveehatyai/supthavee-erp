"use server";

/**
 * User Management Server Actions (Admin only).
 * Zero Client-Side Fetching — Service Role for Auth Admin API + profiles.
 */

import { revalidatePath } from "next/cache";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { requireAdmin } from "@/lib/auth/require-admin";
import { logAuditTrail } from "@/lib/supabase/auditService";
import type { Database } from "@/src/types/supabase";
import type {
  AppRoleOption,
  CreateUserWithPinResult,
  DataAccessScope,
  DeactivateUserResult,
  GetAppRolesResult,
  GetUsersResult,
  ManagedUser,
  ReactivateUserResult,
  UpdateUserAbacResult,
  UpdateUserProfileInput,
  UpdateUserProfileResult,
  UserAbacInput,
} from "@/types/user";
import { DATA_ACCESS_SCOPES } from "@/types/user";

type AdminClient = SupabaseClient<Database>;

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

type ProfileJoinRow = {
  id: string;
  email: string;
  full_name: string;
  role_code: string;
  is_active: boolean | null;
  data_access_scope: string | null;
  approval_limit: number | string | null;
  created_at: string | null;
  updated_at: string | null;
  app_roles:
    | { role_code: string; role_name_th: string; description: string | null }
    | { role_code: string; role_name_th: string; description: string | null }[]
    | null;
};

function isDataAccessScope(value: unknown): value is DataAccessScope {
  return DATA_ACCESS_SCOPES.includes(String(value ?? "").toUpperCase() as DataAccessScope);
}

function parseDataAccessScope(value: unknown): DataAccessScope {
  const normalized = String(value ?? "").trim().toUpperCase();
  return isDataAccessScope(normalized) ? normalized : "OWN";
}

function parseApprovalLimit(value: unknown): number {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.round(parsed * 100) / 100;
}

function normalizeAbacInput(input: UserAbacInput | undefined): {
  data_access_scope: DataAccessScope;
  approval_limit: number;
  error: string | null;
} {
  const scope = parseDataAccessScope(input?.data_access_scope);
  if (input?.data_access_scope && !isDataAccessScope(String(input.data_access_scope).toUpperCase())) {
    return {
      data_access_scope: "OWN",
      approval_limit: 0,
      error: "Data Access Scope ต้องเป็น ALL หรือ OWN เท่านั้น",
    };
  }
  const limit = Number(input?.approval_limit ?? 0);
  if (!Number.isFinite(limit) || limit < 0) {
    return {
      data_access_scope: scope,
      approval_limit: 0,
      error: "วงเงินอนุมัติต้องเป็นตัวเลขที่ไม่ติดลบ",
    };
  }
  return {
    data_access_scope: scope,
    approval_limit: Math.round(limit * 100) / 100,
    error: null,
  };
}

function unwrapRole(
  join: ProfileJoinRow["app_roles"],
): { role_code: string; role_name_th: string } | null {
  if (!join) return null;
  if (Array.isArray(join)) return join[0] ?? null;
  return join;
}

function mapManagedUser(row: ProfileJoinRow): ManagedUser {
  const role = unwrapRole(row.app_roles);
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role_code: row.role_code,
    role_name_th: role?.role_name_th ?? row.role_code,
    is_active: row.is_active !== false,
    data_access_scope: parseDataAccessScope(row.data_access_scope),
    approval_limit: parseApprovalLimit(row.approval_limit),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const UNAUTHORIZED = "Unauthorized";

type ProfileAuditSnapshot = {
  id: string;
  email: string;
  full_name: string;
  role_code: string;
  is_active: boolean | null;
  data_access_scope: string | null;
  approval_limit: number | string | null;
};

function toProfileAuditPayload(row: ProfileAuditSnapshot) {
  return {
    id: row.id,
    email: row.email,
    full_name: row.full_name,
    role_code: row.role_code,
    is_active: row.is_active !== false,
    data_access_scope: parseDataAccessScope(row.data_access_scope),
    approval_limit: parseApprovalLimit(row.approval_limit),
  };
}

/**
 * ITGC / SoD — actor must be an active admin on user_profiles.
 * Fail closed with exact error `Unauthorized` (no allowlist fallback).
 */
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
  if (String(profile.role_code ?? "").trim().toLowerCase() !== "admin") {
    return { ok: false, error: UNAUTHORIZED };
  }

  return { ok: true, actorId: actor.userId };
}

/**
 * รายชื่อผู้ใช้ — Join user_profiles × app_roles (Service Role).
 */
export async function getUsers(): Promise<GetUsersResult> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) {
      return { success: false, error: gate.error, data: [] };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("user_profiles")
      .select(
        `
        id,
        email,
        full_name,
        role_code,
        is_active,
        data_access_scope,
        approval_limit,
        created_at,
        updated_at,
        app_roles (
          role_code,
          role_name_th,
          description
        )
      `,
      )
      .order("created_at", { ascending: false });

    if (error) {
      return { success: false, error: error.message, data: [] };
    }

    const rows = ((data ?? []) as unknown as ProfileJoinRow[]).map(
      mapManagedUser,
    );
    return { success: true, data: rows };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงรายชื่อผู้ใช้งานไม่สำเร็จ";
    return { success: false, error: message, data: [] };
  }
}

/**
 * รายการสิทธิ์จาก app_roles สำหรับฟอร์มสร้างผู้ใช้.
 */
export async function getAppRoles(): Promise<GetAppRolesResult> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) {
      return { success: false, error: gate.error, data: [] };
    }

    const supabaseAdmin = createSupabaseAdminClient();
    const { data, error } = await supabaseAdmin
      .from("app_roles")
      .select("role_code, role_name_th, description")
      .order("role_name_th", { ascending: true });

    if (error) {
      return { success: false, error: error.message, data: [] };
    }

    const roles: AppRoleOption[] = (data ?? []).map((row) => ({
      role_code: row.role_code,
      role_name_th: row.role_name_th,
      description: row.description ?? null,
    }));

    return { success: true, data: roles };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ดึงรายการสิทธิ์ไม่สำเร็จ";
    return { success: false, error: message, data: [] };
  }
}

/**
 * สร้างผู้ใช้ใหม่พร้อมตั้งรหัสผ่าน (PIN) ทันทีผ่าน Auth Admin API
 * แล้ว INSERT โปรไฟล์ลง `user_profiles`.
 */
export async function createUserWithPin(
  email: string,
  pin: string,
  roleCode: string,
  fullName: string,
  abac?: UserAbacInput,
): Promise<CreateUserWithPinResult> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const normalizedEmail = String(email ?? "")
      .trim()
      .toLowerCase();
    const password = String(pin ?? "");
    const normalizedRole = String(roleCode ?? "")
      .trim()
      .toLowerCase();
    const name = String(fullName ?? "").trim();

    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return { success: false, error: "กรุณาระบุอีเมลให้ถูกต้อง" };
    }
    if (!name) {
      return { success: false, error: "กรุณาระบุชื่อผู้ใช้งาน" };
    }
    if (password.length < 6) {
      return {
        success: false,
        error: "รหัสผ่าน (PIN) ต้องมีอย่างน้อย 6 ตัวอักษร",
      };
    }
    if (!/^\d{6}$/.test(password)) {
      return {
        success: false,
        error: "รหัสผ่าน (PIN) ต้องเป็นตัวเลข 6 หลัก",
      };
    }
    if (!normalizedRole) {
      return { success: false, error: "กรุณาเลือกสิทธิ์ (Role)" };
    }

    const abacFields = normalizeAbacInput(
      abac ?? {
        data_access_scope: normalizedRole === "admin" ? "ALL" : "OWN",
        approval_limit: 0,
      },
    );
    if (abacFields.error) {
      return { success: false, error: abacFields.error };
    }

    const supabaseAdmin = createSupabaseAdminClient();

    const { data: roleRow, error: roleError } = await supabaseAdmin
      .from("app_roles")
      .select("role_code")
      .eq("role_code", normalizedRole)
      .maybeSingle();

    if (roleError) {
      return { success: false, error: roleError.message };
    }
    if (!roleRow) {
      return {
        success: false,
        error: `ไม่พบสิทธิ์ "${normalizedRole}" ในตาราง app_roles`,
      };
    }

    const { data: existingProfile } = await supabaseAdmin
      .from("user_profiles")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existingProfile) {
      return {
        success: false,
        error: `อีเมล ${normalizedEmail} มีในระบบแล้ว`,
      };
    }

    const { data: created, error: createError } =
      await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: name,
          role: normalizedRole,
          role_code: normalizedRole,
        },
        app_metadata: {
          role: normalizedRole,
        },
      });

    if (createError || !created.user?.id) {
      return {
        success: false,
        error:
          createError?.message ??
          "สร้างผู้ใช้งานผ่าน Auth ไม่สำเร็จ (createUser)",
      };
    }

    const userId = created.user.id;

    const { error: profileError } = await supabaseAdmin
      .from("user_profiles")
      .insert({
        id: userId,
        email: normalizedEmail,
        full_name: name,
        role_code: normalizedRole,
        is_active: true,
        pin_code: password,
        data_access_scope: abacFields.data_access_scope,
        approval_limit: abacFields.approval_limit,
        updated_at: new Date().toISOString(),
      });

    if (profileError) {
      // Compensating cleanup — อย่าทิ้ง orphan auth user
      await supabaseAdmin.auth.admin.deleteUser(userId);
      return {
        success: false,
        error: `สร้าง Auth สำเร็จ แต่บันทึก user_profiles ไม่สำเร็จ: ${profileError.message}`,
      };
    }

    revalidatePath(USERS_PATH);

    return { success: true, userId };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "สร้างผู้ใช้งานไม่สำเร็จ";
    return { success: false, error: message };
  }
}

/**
 * Soft-delete / Deactivate ผู้ใช้:
 * (A) user_profiles.is_active = false (สถานะ Inactive ในตาราง)
 * (B) Auth ban_duration ยาวมาก — ห้ามล็อกอิน
 */
export async function deactivateUser(
  userId: string,
): Promise<DeactivateUserResult> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const id = String(userId ?? "").trim();
    if (!id) {
      return { success: false, error: "ไม่พบรหัสผู้ใช้ (userId)" };
    }

    // ห้ามระงับตัวเอง
    if (gate.admin.userId && gate.admin.userId === id) {
      return {
        success: false,
        error: "ไม่สามารถระงับบัญชีของตัวเองได้",
      };
    }

    const supabaseAdmin = createSupabaseAdminClient();

    const { data: profile, error: profileLookupError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, email, is_active, role_code")
      .eq("id", id)
      .maybeSingle();

    if (profileLookupError) {
      return { success: false, error: profileLookupError.message };
    }
    if (!profile) {
      return { success: false, error: "ไม่พบผู้ใช้ใน user_profiles" };
    }
    if (profile.is_active === false) {
      return { success: false, error: "ผู้ใช้นี้ถูกระงับสิทธิ์อยู่แล้ว" };
    }

    // (A) Soft deactivate profile — schema ใช้ is_active (เทียบเท่า status = inactive)
    const { error: profileUpdateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        is_active: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (profileUpdateError) {
      return {
        success: false,
        error:
          profileUpdateError.message ??
          "อัปเดตสถานะ user_profiles เป็น Inactive ไม่สำเร็จ",
      };
    }

    // (B) Ban at Auth layer — ~100 years
    const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(
      id,
      { ban_duration: "876000h" },
    );

    if (banError) {
      // Rollback profile if Auth ban fails
      await supabaseAdmin
        .from("user_profiles")
        .update({
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      return {
        success: false,
        error:
          banError.message ??
          "ระงับสิทธิ์ใน Auth ไม่สำเร็จ — คืนสถานะ Active ในโปรไฟล์แล้ว",
      };
    }

    revalidatePath(USERS_PATH);

    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "ระงับสิทธิ์ผู้ใช้งานไม่สำเร็จ";
    return { success: false, error: message };
  }
}

/**
 * Reactivate ผู้ใช้ที่ถูก Soft Delete:
 * (A) user_profiles.is_active = true (สถานะ Active)
 * (B) Auth ban_duration = 'none' — ปลดแบน ใช้ PIN เดิมได้
 */
export async function reactivateUser(
  userId: string,
): Promise<ReactivateUserResult> {
  try {
    const gate = await requireAdmin();
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const id = String(userId ?? "").trim();
    if (!id) {
      return { success: false, error: "ไม่พบรหัสผู้ใช้ (userId)" };
    }

    const supabaseAdmin = createSupabaseAdminClient();

    const { data: profile, error: profileLookupError } = await supabaseAdmin
      .from("user_profiles")
      .select("id, email, is_active")
      .eq("id", id)
      .maybeSingle();

    if (profileLookupError) {
      return { success: false, error: profileLookupError.message };
    }
    if (!profile) {
      return { success: false, error: "ไม่พบผู้ใช้ใน user_profiles" };
    }
    if (profile.is_active !== false) {
      return { success: false, error: "ผู้ใช้นี้เปิดใช้งานอยู่แล้ว" };
    }

    // (A) Soft reactivate — schema ใช้ is_active (เทียบเท่า status = active)
    const { error: profileUpdateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        is_active: true,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (profileUpdateError) {
      return {
        success: false,
        error:
          profileUpdateError.message ??
          "อัปเดตสถานะ user_profiles เป็น Active ไม่สำเร็จ",
      };
    }

    // (B) Unban at Auth layer
    const { error: unbanError } = await supabaseAdmin.auth.admin.updateUserById(
      id,
      { ban_duration: "none" },
    );

    if (unbanError) {
      // Rollback profile if Auth unban fails
      await supabaseAdmin
        .from("user_profiles")
        .update({
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id);

      return {
        success: false,
        error:
          unbanError.message ??
          "ปลดแบน Auth ไม่สำเร็จ — คืนสถานะ Inactive ในโปรไฟล์แล้ว",
      };
    }

    revalidatePath(USERS_PATH);

    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "เปิดใช้งานผู้ใช้ไม่สำเร็จ";
    return { success: false, error: message };
  }
}

/**
 * Update User Profile (ITGC / SoD):
 * - Auth Guard: session user.id ต้องมี role_code = admin มิฉะนั้นคืน `Unauthorized`
 * - Update user_profiles ผ่าน supabaseAdmin (Service Role / Bypass RLS)
 * - Insert audit_logs (old_data / new_data) ผ่าน supabaseAdmin เสมอ
 */
export async function updateUserProfile(
  userId: string,
  input: UpdateUserProfileInput,
): Promise<UpdateUserProfileResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const gate = await assertAdminActor(supabaseAdmin);
    if (!gate.ok) {
      return { success: false, error: gate.error };
    }

    const id = String(userId ?? "").trim();
    if (!id) {
      return { success: false, error: "ไม่พบรหัสผู้ใช้ (userId)" };
    }

    const abacFields = normalizeAbacInput({
      data_access_scope: input.data_access_scope,
      approval_limit: input.approval_limit,
    });
    if (abacFields.error) {
      return { success: false, error: abacFields.error };
    }

    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("user_profiles")
      .select(
        "id, email, full_name, role_code, is_active, data_access_scope, approval_limit",
      )
      .eq("id", id)
      .maybeSingle();

    if (lookupError) {
      return { success: false, error: lookupError.message };
    }
    if (!existing) {
      return { success: false, error: "ไม่พบผู้ใช้ใน user_profiles" };
    }

    const currentRole = String(existing.role_code ?? "").trim().toLowerCase();
    const requestedRole = String(input.role_code ?? existing.role_code ?? "")
      .trim()
      .toLowerCase();
    const nextRole = requestedRole || currentRole;

    if (!nextRole) {
      return { success: false, error: "กรุณาเลือกสิทธิ์ (Role)" };
    }

    if (nextRole !== currentRole) {
      if (gate.actorId === id && nextRole !== "admin") {
        return {
          success: false,
          error: "ไม่สามารถลดสิทธิ์ Admin ของบัญชีตนเองได้",
        };
      }

      const { data: roleRow, error: roleError } = await supabaseAdmin
        .from("app_roles")
        .select("role_code")
        .eq("role_code", nextRole)
        .maybeSingle();

      if (roleError) {
        return { success: false, error: roleError.message };
      }
      if (!roleRow) {
        return {
          success: false,
          error: `ไม่พบสิทธิ์ "${nextRole}" ในตาราง app_roles`,
        };
      }
    }

    const oldData = toProfileAuditPayload(existing as ProfileAuditSnapshot);
    const nextScope = abacFields.data_access_scope;
    const nextLimit = abacFields.approval_limit;
    const unchanged =
      oldData.role_code.toLowerCase() === nextRole &&
      oldData.data_access_scope === nextScope &&
      oldData.approval_limit === nextLimit;

    if (unchanged) {
      return { success: true };
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("user_profiles")
      .update({
        role_code: nextRole,
        data_access_scope: nextScope,
        approval_limit: nextLimit,
        updated_at: nowIso,
      })
      .eq("id", id)
      .select(
        "id, email, full_name, role_code, is_active, data_access_scope, approval_limit",
      )
      .maybeSingle();

    if (updateError || !updated) {
      return {
        success: false,
        error: updateError?.message ?? "บันทึกโปรไฟล์ผู้ใช้ไม่สำเร็จ",
      };
    }

    const newData = toProfileAuditPayload(updated as ProfileAuditSnapshot);

    const audit = await logAuditTrail(
      "user_profiles",
      id,
      "UPDATE",
      oldData,
      newData,
    );

    if (!audit.success) {
      return {
        success: false,
        error: `อัปเดต user_profiles สำเร็จ แต่บันทึก audit_logs ไม่สำเร็จ: ${audit.error}`,
      };
    }

    revalidatePath(USERS_PATH);
    return { success: true };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "บันทึกโปรไฟล์ผู้ใช้ไม่สำเร็จ";
    return { success: false, error: message };
  }
}

/**
 * @deprecated ใช้ {@link updateUserProfile} — คงไว้เพื่อความเข้ากันได้ของฟอร์มเดิม
 */
export async function updateUserAbacSettings(
  userId: string,
  abac: UserAbacInput,
): Promise<UpdateUserAbacResult> {
  return updateUserProfile(userId, abac);
}
