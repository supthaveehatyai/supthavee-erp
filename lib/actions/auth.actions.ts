"use server";

/**
 * Auth Server Actions — PIN login via Supabase Auth.
 * Session cookies are set by @supabase/ssr (Zero Client-Side Fetching).
 * Types live in `@/types/auth`.
 */

import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { createClient } from "@/lib/supabase/server-admin";
import { createSupabaseSSRClient } from "@/lib/supabase/ssr-server";
import type { AuthGateProfile, SignInWithPinResult, SignOutResult } from "@/types/auth";

const DASHBOARD_PATH = "/dashboard";
const LOGIN_PATH = "/login";

function normalizeEmail(email: string): string {
  return String(email ?? "")
    .trim()
    .toLowerCase();
}

function normalizePin(pin: string): string {
  return String(pin ?? "").trim();
}

/**
 * Sign in with email + PIN (stored as Auth password via createUserWithPin).
 * Also gates on user_profiles.is_active and optional pin_code match.
 * On success: redirects to /dashboard (cookies written by SSR client).
 */
export async function signInWithPin(
  email: string,
  pin: string,
): Promise<SignInWithPinResult> {
  const normalizedEmail = normalizeEmail(email);
  const password = normalizePin(pin);

  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    return { success: false, error: "กรุณาระบุอีเมลให้ถูกต้อง" };
  }

  if (!/^\d{6}$/.test(password)) {
    return {
      success: false,
      error: "รหัสผ่าน (PIN) ต้องเป็นตัวเลข 6 หลัก",
    };
  }

  try {
    const supabase = await createSupabaseSSRClient();

    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password,
    });

    if (error || !data.user) {
      return {
        success: false,
        error: "อีเมลหรือรหัส PIN ไม่ถูกต้อง",
      };
    }

    // Soft-delete + optional profile PIN gate (Service Role).
    const admin = createClient();
    const { data: profile } = await admin
      .from("user_profiles")
      .select("id, is_active, full_name, pin_code")
      .eq("id", data.user.id)
      .maybeSingle();

    const gateProfile = profile as AuthGateProfile | null;

    if (gateProfile && gateProfile.is_active === false) {
      await supabase.auth.signOut();
      return {
        success: false,
        error: "บัญชีนี้ถูกระงับการใช้งาน — ติดต่อผู้ดูแลระบบ",
      };
    }

    // If pin_code is set on profile, require exact 6-digit match (legacy null = Auth-only).
    const storedPin = gateProfile?.pin_code?.trim() ?? "";
    if (storedPin && storedPin !== password) {
      await supabase.auth.signOut();
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
