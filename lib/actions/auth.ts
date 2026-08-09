"use server";

/**
 * Phase 10 — Auth / RBAC Server Actions.
 * Zero Client-Side Fetching: Service Role only.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/src/types/supabase";

type AdminClient = SupabaseClient<Database>;

export type AppRole = {
  role_code: string;
  role_name_th: string;
  description: string | null;
  created_at: string | null;
};

export type GetAllRolesResult =
  | { success: true; data: AppRole[] }
  | { success: false; error: string };

function createSupabaseAdminClient(): AdminClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_SERVICE_ROLE_KEY (หรือ NEXT_PUBLIC_SUPABASE_URL) — ตั้งค่าใน .env.development แล้วรีสตาร์ท next dev",
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

/**
 * ดึงรายการ Role ทั้งหมดจาก `app_roles` (Dynamic RBAC master).
 * ใช้ Service Role Key — ทะลุ RLS ตามมาตรฐาน Zero Client-Side Fetching.
 */
export async function getAllRoles(): Promise<GetAllRolesResult> {
  try {
    const supabaseAdmin = createSupabaseAdminClient();

    const { data, error } = await supabaseAdmin
      .from("app_roles")
      .select("role_code, role_name_th, description, created_at")
      .order("role_code", { ascending: true });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true, data: (data ?? []) as AppRole[] };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to load app_roles";
    return { success: false, error: message };
  }
}
