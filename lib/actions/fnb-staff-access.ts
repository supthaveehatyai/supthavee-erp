"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { getCurrentAuthUser } from "@/lib/auth/current-user";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { getUserAccessContext, requireSuperAdmin } from "@/lib/holding/workspace-access";
import { createClient } from "@/lib/supabase/server-admin";
import type { FnbStaffAccountRow, FnbStaffDraft } from "@/types/holding";

const LUCKY_BRANCHES = ["LC-HDY", "LC-PSU"];
const CHATORN_BRANCHES = ["CT-KLN", "CT-BNP", "CT-NMM"];

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function branchesOf(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

function allowedBranches(brand: string): string[] {
  return brand === "CHATORN" ? CHATORN_BRANCHES : LUCKY_BRANCHES;
}

function badgeFor(row: Record<string, unknown>): string {
  if (row.is_super_admin === true) return "👑 Super Admin ทุกธุรกิจ";
  const branches = branchesOf(row.allowed_branch_codes);
  const brand = text(row.assigned_brand_code);
  if (text(row.primary_workspace) === "fnb" || text(row.workspace_role).startsWith("FNB_")) {
    const names = branches.join(", ");
    if (brand === "CHATORN") return names ? `🟠 ชาทร (${names})` : "🟠 ชาทรตะโหมด";
    return names ? `🔴 Lucky Cup (${names})` : "🔴 ร้านน้ำ";
  }
  return "🔵 เฉพาะทรัพย์ทวี";
}

async function grantRows(): Promise<Record<string, unknown>[]> {
  const listed = await schemaAdmin()
    .schema("holding")
    .from("user_workspace_grants")
    .select("user_id, is_super_admin, primary_workspace, workspace_role, assigned_brand_code, allowed_branch_codes, staff_nickname, is_active");
  return Array.isArray(listed.data) ? listed.data as Record<string, unknown>[] : [];
}

export async function listUserWorkspaceBadges(): Promise<Record<string, string>> {
  const current = await getCurrentAuthUser();
  if (!current) return {};
  const ctx = await getUserAccessContext(current.userId);
  if (!ctx?.isSuperAdmin && current.roleCode !== "admin") return {};
  try {
    const rows = await grantRows();
    return Object.fromEntries(rows.map((row) => [text(row.user_id), badgeFor(row)]));
  } catch {
    return {};
  }
}

export async function listFnbStaffAccounts(): Promise<{ data: FnbStaffAccountRow[]; error: string | null }> {
  try {
    await requireSuperAdmin();
    const [grants, profiles] = await Promise.all([
      grantRows(),
      schemaAdmin().from("user_profiles").select("id, email, full_name, is_active"),
    ]);
    const people = new Map(
      (Array.isArray(profiles.data) ? profiles.data as Record<string, unknown>[] : []).map((row) => [text(row.id), row]),
    );
    const data = grants
      .filter((row) => text(row.primary_workspace) === "fnb" || text(row.workspace_role).startsWith("FNB_"))
      .map((row) => {
        const person = people.get(text(row.user_id));
        return {
          userId: text(row.user_id),
          email: text(person?.email),
          fullName: text(person?.full_name),
          staffNickname: text(row.staff_nickname),
          workspaceRole: text(row.workspace_role),
          brandCode: text(row.assigned_brand_code) || null,
          branchCodes: branchesOf(row.allowed_branch_codes),
          isActive: row.is_active !== false && person?.is_active !== false,
        };
      });
    return { data, error: null };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { data: [], error: err instanceof Error ? err.message : "โหลดพนักงานร้านน้ำไม่สำเร็จ" };
  }
}

function validateDraft(input: FnbStaffDraft, creating: boolean): string | null {
  if (!text(input.fullName)) return "กรุณาระบุชื่อ-นามสกุลจริง";
  if (!text(input.staffNickname)) return "กรุณาระบุชื่อเล่นในร้าน";
  const email = text(input.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "กรุณาระบุอีเมลให้ถูกต้อง";
  if (creating && !/^\d{6}$/.test(text(input.pin))) return "รหัส PIN ต้องเป็นตัวเลข 6 หลัก";
  if (input.brandCode !== "LUCKY_CUP" && input.brandCode !== "CHATORN") return "กรุณาเลือกแบรนด์";
  if (!["FNB_STORE_STAFF", "FNB_BRANCH_MANAGER", "FNB_ACCOUNTANT"].includes(input.workspaceRole)) {
    return "กรุณาเลือกบทบาท";
  }
  const pool = allowedBranches(input.brandCode);
  if (input.branchCodes.length === 0 || input.branchCodes.some((code) => !pool.includes(code))) {
    return "เลือกสาขาในแบรนด์ที่สังกัดเท่านั้น";
  }
  return null;
}

export async function createFnbStaffAccount(input: FnbStaffDraft): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSuperAdmin();
    const invalid = validateDraft(input, true);
    if (invalid) return { success: false, error: invalid };
    const email = text(input.email).toLowerCase();
    const roleCode = input.workspaceRole === "FNB_ACCOUNTANT" ? "fnb_accountant" : "fnb_staff";
    const admin = createClient();
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: text(input.pin),
      email_confirm: true,
      user_metadata: { full_name: text(input.fullName), role_code: roleCode },
    });
    if (createError || !created.user?.id) return { success: false, error: createError?.message ?? "สร้างบัญชีไม่สำเร็จ" };
    const userId = created.user.id;
    const profile = await admin.from("user_profiles").insert({
      id: userId,
      email,
      full_name: text(input.fullName),
      role_code: roleCode,
      is_active: true,
      pin_code: text(input.pin),
      data_access_scope: "OWN",
      approval_limit: 0,
      updated_at: new Date().toISOString(),
    });
    if (profile.error) {
      await admin.auth.admin.deleteUser(userId);
      return { success: false, error: profile.error.message };
    }
    const grant = await schemaAdmin().schema("holding").from("user_workspace_grants").insert({
      user_id: userId,
      is_super_admin: false,
      primary_workspace: "fnb",
      workspace_role: input.workspaceRole,
      allowed_workspaces: ["fnb"],
      assigned_brand_code: input.brandCode,
      allowed_branch_codes: input.branchCodes,
      staff_nickname: text(input.staffNickname),
      can_view_fnb_reports: false,
      can_view_cost_price: false,
      is_active: true,
    });
    if (grant.error) {
      await admin.from("user_profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
      return { success: false, error: grant.error.message ?? "บันทึกสิทธิ์ร้านน้ำไม่สำเร็จ" };
    }
    revalidatePath("/settings/users");
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "สร้างพนักงานร้านน้ำไม่สำเร็จ" };
  }
}

export async function updateFnbStaffAccount(input: FnbStaffDraft): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSuperAdmin();
    const userId = text(input.userId);
    if (!userId) return { success: false, error: "ไม่พบบัญชีที่ต้องการแก้" };
    const invalid = validateDraft(input, false);
    if (invalid) return { success: false, error: invalid };
    const roleCode = input.workspaceRole === "FNB_ACCOUNTANT" ? "fnb_accountant" : "fnb_staff";
    const profile = await createClient()
      .from("user_profiles")
      .update({ full_name: text(input.fullName), role_code: roleCode, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (profile.error) return { success: false, error: profile.error.message };
    const grant = await schemaAdmin().schema("holding").from("user_workspace_grants").update({
      workspace_role: input.workspaceRole,
      assigned_brand_code: input.brandCode,
      allowed_branch_codes: input.branchCodes,
      staff_nickname: text(input.staffNickname),
      primary_workspace: "fnb",
      allowed_workspaces: ["fnb"],
      is_super_admin: false,
      can_view_fnb_reports: false,
      can_view_cost_price: false,
    }).eq("user_id", userId);
    if (grant.error) return { success: false, error: grant.error.message ?? "แก้สิทธิ์ไม่สำเร็จ" };
    revalidatePath("/settings/users");
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "แก้ไขพนักงานไม่สำเร็จ" };
  }
}

export async function resetFnbStaffPin(userId: string, pin: string): Promise<{ success: boolean; error?: string }> {
  try {
    await requireSuperAdmin();
    const id = text(userId);
    const nextPin = text(pin);
    if (!/^\d{6}$/.test(nextPin)) return { success: false, error: "รหัส PIN ต้องเป็นตัวเลข 6 หลัก" };
    const admin = createClient();
    const auth = await admin.auth.admin.updateUserById(id, { password: nextPin, email_confirm: true });
    if (auth.error) return { success: false, error: auth.error.message };
    const profile = await admin.from("user_profiles").update({ pin_code: nextPin, updated_at: new Date().toISOString() }).eq("id", id);
    if (profile.error) return { success: false, error: profile.error.message };
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "รีเซ็ต PIN ไม่สำเร็จ" };
  }
}

export async function suspendFnbStaffAccount(userId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const owner = await requireSuperAdmin();
    const id = text(userId);
    if (!id || id === owner.userId) return { success: false, error: "ไม่สามารถระงับบัญชีนี้ได้" };
    const admin = createClient();
    const profile = await admin.from("user_profiles").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id);
    if (profile.error) return { success: false, error: profile.error.message };
    const grant = await schemaAdmin().schema("holding").from("user_workspace_grants").update({
      is_active: false,
      deactivated_at: new Date().toISOString(),
      deactivation_reason: "ลาออก / ระงับสิทธิ์ทันที",
    }).eq("user_id", id);
    if (grant.error) return { success: false, error: grant.error.message ?? "ระงับสิทธิ์ร้านน้ำไม่สำเร็จ" };
    const banned = await admin.auth.admin.updateUserById(id, { ban_duration: "876000h" });
    if (banned.error) return { success: false, error: banned.error.message };
    const signer = admin.auth.admin as { signOut?: (uid: string, scope?: "global") => Promise<{ error: { message: string } | null }> };
    await signer.signOut?.(id, "global");
    revalidatePath("/settings/users");
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "ระงับสิทธิ์ไม่สำเร็จ" };
  }
}
