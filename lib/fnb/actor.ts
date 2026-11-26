import { cookies } from "next/headers";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server-admin";
import { requireFnbStoreOperationAccess } from "@/lib/holding/workspace-access";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { FNB_LIFF_SUSPENDED_MESSAGE, type FnbActor, type FnbBrandCode } from "@/types/fnb";

export const FNB_LIFF_COOKIE = "fnb_liff_line_user_id";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function brandOf(value: string | null): FnbBrandCode | null {
  return value === "LUCKY_CUP" || value === "CHATORN" ? value : null;
}

export async function readLiffActor(): Promise<{ actor: FnbActor | null; error: string | null }> {
  const jar = await cookies();
  const lineUserId = jar.get(FNB_LIFF_COOKIE)?.value?.trim() ?? "";
  if (!lineUserId) return { actor: null, error: "กรุณาเข้าสู่ระบบด้วยรหัส LINE ที่ลงทะเบียนไว้" };
  const listed = await schemaAdmin()
    .schema("holding")
    .from("liff_user_registrations")
    .select("line_user_id, display_name, staff_nickname, approval_status, is_active, branch_code, assigned_brand_code")
    .eq("line_user_id", lineUserId)
    .maybeSingle();
  if (listed.error) return { actor: null, error: listed.error.message || "ตรวจสิทธิ์พนักงานไม่สำเร็จ" };
  const row = listed.data && typeof listed.data === "object" ? listed.data as Record<string, unknown> : null;
  if (!row) return { actor: null, error: "ไม่พบรหัสนี้ในทะเบียนพนักงาน" };
  if (row.is_active !== true || text(row.approval_status) !== "APPROVED") {
    return { actor: null, error: FNB_LIFF_SUSPENDED_MESSAGE };
  }
  const brand = brandOf(text(row.assigned_brand_code));
  if (!brand) return { actor: null, error: "บัญชียังไม่ได้กำหนดแบรนด์" };
  return {
    actor: {
      name: text(row.staff_nickname) || text(row.display_name) || "พนักงาน",
      lineUserId,
      userId: null,
      branchCode: text(row.branch_code) || null,
      brandCode: brand,
      source: "liff",
    },
    error: null,
  };
}

export async function readDesktopActor(): Promise<{ actor: FnbActor | null; error: string | null }> {
  const session = await requireSessionUserId();
  if (!session.ok) return { actor: null, error: session.error };
  const profile = await createClient().from("user_profiles").select("full_name").eq("id", session.userId).maybeSingle();
  const name = text((profile.data as { full_name?: string | null } | null)?.full_name) || "ผู้ใช้งาน";
  return {
    actor: { name, lineUserId: null, userId: session.userId, branchCode: null, brandCode: null, source: "desktop" },
    error: null,
  };
}

export async function resolveFnbActor(input: {
  actorSource: string | null;
  brandLock: string | null;
  branchCode: string | null;
}): Promise<{ ok: true; actor: FnbActor } | { ok: false; error: string }> {
  const gate = await requireFnbStoreOperationAccess(input.branchCode || undefined);
  if (!gate.ok) return { ok: false, error: gate.error };
  const expected = brandOf(input.brandLock);
  if (expected && !gate.ctx.isSuperAdmin && gate.ctx.assignedBrandCode && gate.ctx.assignedBrandCode !== expected) {
    return { ok: false, error: "บัญชีนี้ไม่ได้รับสิทธิ์แบรนด์นี้" };
  }
  return {
    ok: true,
    actor: {
      name: gate.displayActorName,
      lineUserId: null,
      userId: gate.userId,
      branchCode: input.branchCode,
      brandCode: expected ?? (gate.ctx.assignedBrandCode === "LUCKY_CUP" || gate.ctx.assignedBrandCode === "CHATORN" ? gate.ctx.assignedBrandCode : null),
      source: input.actorSource === "liff" ? "liff" : "desktop",
    },
  };
}
