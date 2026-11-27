"use server";

/**
 * Auth Server Actions — PIN login via user_profiles + Supabase Auth session cookies.
 * Session cookies are set by @supabase/ssr in this Server Action (App Router).
 * Types live in `@/types/auth`.
 */

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createClient } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";
import { accessRedirect, homeAfterLogin, safeInternalPath } from "@/lib/holding/access-routes";
import { weakPinReason } from "@/lib/holding/pin-policy";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { getUserAccessContext } from "@/lib/holding/workspace-access";
import type { AuthGateProfile, SignInWithPinResult, SignOutResult } from "@/types/auth";

const DASHBOARD_PATH = "/dashboard";
const LOGIN_PATH = "/login";

function normalizeEmail(email: unknown): string {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

function pinAsString(value: unknown): string {
  return String(value ?? "").trim();
}

function escapeIlikeExact(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function pinsMatch(pinInput: unknown, dbPin: unknown): boolean {
  return pinAsString(pinInput).toString() === pinAsString(dbPin).toString();
}

function loginBlockMessage(reason: string): string {
  if (reason === "DEACTIVATED") return "บัญชีนี้ถูกระงับสิทธิ์การเข้าใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ";
  if (reason === "NOT_STARTED_YET") return "บัญชียังไม่เปิดใช้งานจนถึงวันเริ่มงานจริง";
  if (reason === "TEMP_LOCKED") return "กดรหัส PIN ผิดเกิน 5 ครั้ง ระบบล็อกชั่วคราว 15 นาที";
  return "ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง";
}

type HoldingAuth = {
  schema: (name: "holding") => {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
};

async function resolveLogin(
  admin: ReturnType<typeof createClient>,
  identifier: string,
): Promise<{ ok: true; userId: string; authEmail: string; mustChangePin: boolean } | { ok: false; error: string }> {
  const rpc = await (admin as unknown as HoldingAuth).schema("holding").rpc("resolve_login_identifier", { p_identifier: identifier });
  const row = rpc.data && typeof rpc.data === "object" ? rpc.data as Record<string, unknown> : null;
  if (!rpc.error && row) {
    if (row.ok === true) {
      return {
        ok: true,
        userId: String(row.user_id),
        authEmail: normalizeEmail(row.auth_email),
        mustChangePin: row.must_change_pin === true,
      };
    }
    return { ok: false, error: loginBlockMessage(String(row.reason ?? "")) };
  }
  const profile = identifier.includes("@") ? await loadProfileByEmail(admin, identifier) : null;
  if (!profile || profile.is_active === false) {
    return { ok: false, error: profile ? loginBlockMessage("DEACTIVATED") : loginBlockMessage("NOT_FOUND") };
  }
  return { ok: true, userId: profile.id, authEmail: normalizeEmail(profile.email), mustChangePin: false };
}

async function loadProfileById(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<AuthGateProfile | null> {
  const { data, error } = await admin
    .from("user_profiles")
    .select("id, email, is_active, full_name, pin_code")
    .eq("id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as AuthGateProfile;
}

async function recordLogin(
  admin: ReturnType<typeof createClient>,
  userId: string,
  success: boolean,
): Promise<void> {
  await (admin as unknown as HoldingAuth).schema("holding").rpc("record_login_attempt", {
    p_user_id: userId,
    p_success: success,
  });
}

async function loadProfileByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<AuthGateProfile | null> {
  const { data: exact, error: exactError } = await admin
    .from("user_profiles")
    .select("id, email, is_active, full_name, pin_code")
    .eq("email", email)
    .maybeSingle();

  if (exactError) {
    console.error("[signInWithPin:profile.eq]", exactError.message);
  }
  if (exact) {
    return exact as AuthGateProfile;
  }

  const { data: fuzzy, error: fuzzyError } = await admin
    .from("user_profiles")
    .select("id, email, is_active, full_name, pin_code")
    .ilike("email", escapeIlikeExact(email))
    .limit(10);

  if (fuzzyError) {
    console.error("[signInWithPin:profile.ilike]", fuzzyError.message);
    return null;
  }

  const match = (fuzzy ?? []).find(
    (row) => normalizeEmail(row.email) === email,
  );
  return (match as AuthGateProfile | undefined) ?? null;
}

/**
 * Sync Auth password to the verified PIN so signInWithPassword can set cookies.
 * Source of truth is user_profiles.pin_code (not the previous Auth password).
 */
async function findAuthUserIdByEmail(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<string | null> {
  const { data, error } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (error) {
    console.error("[signInWithPin:listUsers]", error.message);
    return null;
  }
  const found = (data.users ?? []).find(
    (user) => normalizeEmail(user.email) === email,
  );
  return found?.id ?? null;
}

async function syncAuthPasswordToPin(
  admin: ReturnType<typeof createClient>,
  userId: string,
  email: string,
  pin: string,
): Promise<boolean> {
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    password: pin,
    email,
    email_confirm: true,
  });

  if (!updateError) {
    return true;
  }

  console.error("[signInWithPin:syncAuth]", updateError.message);

  const existingId = await findAuthUserIdByEmail(admin, email);
  if (existingId) {
    const { error: retryError } = await admin.auth.admin.updateUserById(
      existingId,
      { password: pin, email_confirm: true },
    );
    if (!retryError) {
      return true;
    }
    console.error("[signInWithPin:syncAuthByEmail]", retryError.message);
    return false;
  }

  const { data: created, error: createError } =
    await admin.auth.admin.createUser({
      email,
      password: pin,
      email_confirm: true,
    });

  if (!createError && created.user?.id) {
    return true;
  }

  console.error(
    "[signInWithPin:createAuth]",
    createError?.message ?? "สร้าง Auth user ไม่สำเร็จ",
  );
  return false;
}

/**
 * Sign in with email + PIN from `user_profiles`.
 * 1) Sanitize email  2) Compare PIN as String  3) Set Auth session cookies
 * On success: redirects to /dashboard.
 */
export async function signInWithPin(
  email: string,
  pin: string,
  nextPath?: string | null,
): Promise<SignInWithPinResult> {
  const identifier = normalizeEmail(email);
  const pinInput = pinAsString(pin).toString();

  if (!identifier || identifier.length < 3) {
    return { success: false, error: "กรุณาระบุชื่อผู้ใช้หรืออีเมล" };
  }

  if (!/^\d{6}$/.test(pinInput)) {
    return {
      success: false,
      error: "รหัสผ่าน (PIN) ต้องเป็นตัวเลข 6 หลัก",
    };
  }

  try {
    const admin = createClient();
    const resolved = await resolveLogin(admin, identifier);
    if (!resolved.ok) return { success: false, error: resolved.error };
    const profile = await loadProfileById(admin, resolved.userId);

    if (!profile) {
      return {
        success: false,
        error: "ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง",
      };
    }

    const dbPin = pinAsString(profile.pin_code).toString();
    if (!dbPin || !pinsMatch(pinInput, dbPin)) {
      await recordLogin(admin, profile.id, false);
      return {
        success: false,
        error: "ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง",
      };
    }

    // Keep Auth password in sync with the verified profile PIN, then set cookies.
    const synced = await syncAuthPasswordToPin(
      admin,
      profile.id,
      resolved.authEmail,
      pinInput,
    );
    if (!synced) {
      return {
        success: false,
        error: "สร้างเซสชันไม่สำเร็จ — ตรวจสอบ Auth User ของอีเมลนี้",
      };
    }

    const supabase = await createSupabaseSSRClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: resolved.authEmail,
      password: pinInput,
    });

    if (error || !data.user || !data.session) {
      console.error(
        "[signInWithPin:session]",
        error?.message ?? "signInWithPassword ไม่ได้ session",
      );
      return {
        success: false,
        error: "ชื่อผู้ใช้หรือรหัส PIN ไม่ถูกต้อง",
      };
    }

    await recordLogin(admin, profile.id, true);
    const ctx = await getUserAccessContext(profile.id);
    if (ctx && !ctx.isActive) {
      await supabase.auth.signOut();
      return { success: false, error: "บัญชีนี้ถูกระงับสิทธิ์การเข้าใช้งานแล้ว กรุณาติดต่อผู้ดูแลระบบ" };
    }
    if (ctx?.mustChangePin || resolved.mustChangePin) redirect("/change-pin");
    const requested = safeInternalPath(nextPath);
    const destination = ctx
      ? requested && accessRedirect(requested, ctx) === null && homeAfterLogin(ctx) === DASHBOARD_PATH
        ? requested
        : homeAfterLogin(ctx)
      : requested || DASHBOARD_PATH;
    redirect(destination);
  } catch (err) {
    if (isRedirectError(err)) throw err;

    const message =
      err instanceof Error ? err.message : "เข้าสู่ระบบไม่สำเร็จ";
    console.error("[signInWithPin]", message);
    return { success: false, error: message };
  }
}

/**
 * Sign out and clear Auth cookies, then redirect to /login.
 */
export async function signOut(): Promise<SignOutResult> {
  try {
    const supabase = await createSupabaseSSRClient();
    const { error } = await supabase.auth.signOut();
    if (error) {
      return { success: false, error: error.message };
    }
  } catch (err) {
    if (isRedirectError(err)) throw err;
    const message =
      err instanceof Error ? err.message : "ออกจากระบบไม่สำเร็จ";
    console.error("[signOut]", message);
    return { success: false, error: message };
  }

  redirect(LOGIN_PATH);
}

export async function changeOwnPin(pin: string, confirm: string): Promise<SignInWithPinResult> {
  const nextPin = pinAsString(pin);
  const weak = weakPinReason(nextPin);
  if (weak) return { success: false, error: weak };
  if (nextPin !== pinAsString(confirm)) return { success: false, error: "รหัส PIN ทั้งสองช่องไม่ตรงกัน" };
  try {
    const supabase = await createSupabaseSSRClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user?.id) redirect("/login");
    const admin = createClient();
    const updated = await admin.auth.admin.updateUserById(data.user.id, { password: nextPin, email_confirm: true });
    if (updated.error) return { success: false, error: updated.error.message };
    const profile = await admin.from("user_profiles").update({ pin_code: nextPin, updated_at: new Date().toISOString() }).eq("id", data.user.id);
    if (profile.error) return { success: false, error: profile.error.message };
    const grant = await schemaAdmin().schema("holding").from("user_workspace_grants").update({
      must_change_pin: false,
      pin_changed_at: new Date().toISOString(),
    }).eq("user_id", data.user.id);
    if (grant.error) return { success: false, error: grant.error.message ?? "บันทึกสถานะ PIN ไม่สำเร็จ" };
    const ctx = await getUserAccessContext(data.user.id);
    await schemaAdmin().schema("holding").from("iam_hr_audit_logs").insert({
      workspace_key: ctx?.primaryWorkspace ?? "supthavee",
      action_type: "PIN_CHANGED",
      actor_user_id: data.user.id,
      actor_name: ctx?.displayActorName || ctx?.username || "ผู้ใช้งาน",
      target_user_id: data.user.id,
      target_name: ctx?.fullName || null,
      details_json: { source: "first-login" },
    });
    redirect(ctx ? homeAfterLogin({ ...ctx, mustChangePin: false }) : DASHBOARD_PATH);
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "เปลี่ยนรหัส PIN ไม่สำเร็จ" };
  }
}
