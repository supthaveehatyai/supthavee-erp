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
): Promise<SignInWithPinResult> {
  const normalizedEmail = normalizeEmail(email);
  const pinInput = pinAsString(pin).toString();

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { success: false, error: "กรุณาระบุอีเมลให้ถูกต้อง" };
  }

  if (!/^\d{6}$/.test(pinInput)) {
    return {
      success: false,
      error: "รหัสผ่าน (PIN) ต้องเป็นตัวเลข 6 หลัก",
    };
  }

  try {
    const admin = createClient();
    const profile = await loadProfileByEmail(admin, normalizedEmail);

    if (!profile) {
      return {
        success: false,
        error: "อีเมลหรือรหัส PIN ไม่ถูกต้อง",
      };
    }

    if (profile.is_active === false) {
      return {
        success: false,
        error: "บัญชีนี้ถูกระงับการใช้งาน — ติดต่อผู้ดูแลระบบ",
      };
    }

    const dbPin = pinAsString(profile.pin_code).toString();
    if (!dbPin || !pinsMatch(pinInput, dbPin)) {
      return {
        success: false,
        error: "อีเมลหรือรหัส PIN ไม่ถูกต้อง",
      };
    }

    // Keep Auth password in sync with the verified profile PIN, then set cookies.
    const synced = await syncAuthPasswordToPin(
      admin,
      profile.id,
      normalizedEmail,
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
      email: normalizedEmail,
      password: pinInput,
    });

    if (error || !data.user || !data.session) {
      console.error(
        "[signInWithPin:session]",
        error?.message ?? "signInWithPassword ไม่ได้ session",
      );
      return {
        success: false,
        error: "อีเมลหรือรหัส PIN ไม่ถูกต้อง",
      };
    }

    redirect(DASHBOARD_PATH);
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
