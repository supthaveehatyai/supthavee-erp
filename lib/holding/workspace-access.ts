import "server-only";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireSessionUserId } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server-admin";
import { SUPER_ADMIN_EMAIL, SUPER_ADMIN_FULL_NAME, type UserAccessContext, type WorkspaceKey } from "@/types/holding";
import { accessRedirect, fnbStaffHome, parseAccessPayload } from "@/lib/holding/access-routes";
import { isSchemaUnavailable, schemaAdmin } from "@/lib/holding/schema-db";

function nameMatches(fullName?: string | null): boolean {
  return fullName?.trim() === SUPER_ADMIN_FULL_NAME;
}

type HoldingRpc = {
  schema: (name: "holding") => {
    rpc: (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string; code?: string } | null }>;
  };
};

async function fallbackAccess(userId: string): Promise<UserAccessContext | null> {
  const admin = schemaAdmin();
  const profile = await admin
    .from("user_profiles")
    .select("id, email, full_name, role_code, is_active")
    .eq("id", userId)
    .maybeSingle();
  const person = profile.data as {
    id?: string;
    email?: string | null;
    full_name?: string | null;
    role_code?: string | null;
    is_active?: boolean | null;
  } | null;
  if (!person?.id) return null;
  const email = String(person.email ?? "").trim().toLowerCase();
  const roleCode = String(person.role_code ?? "").trim().toLowerCase();
  const grant = await admin
    .schema("holding")
    .from("user_workspace_grants")
    .select("is_super_admin, primary_workspace, workspace_role, allowed_workspaces, assigned_brand_code, allowed_branch_codes, staff_nickname, can_view_fnb_reports, can_view_cost_price, is_active")
    .eq("user_id", userId)
    .maybeSingle();
  if (grant.error && !isSchemaUnavailable(grant.error)) return null;
  const row = (grant.data ?? null) as Record<string, unknown> | null;
  const superEmail = email === SUPER_ADMIN_EMAIL;
  const nickname = String(row?.staff_nickname ?? "").trim();
  return parseAccessPayload({
    found: true,
    user_id: person.id,
    email,
    full_name: person.full_name,
    display_actor_name: nickname || person.full_name || email,
    role_code: roleCode,
    is_active: person.is_active !== false && row?.is_active !== false,
    is_super_admin: row ? row.is_super_admin === true : superEmail,
    primary_workspace: row?.primary_workspace ?? (roleCode === "fnb_staff" || roleCode === "fnb_accountant" ? "fnb" : "supthavee"),
    workspace_role: row?.workspace_role ?? (superEmail ? "SUPER_ADMIN" : roleCode === "fnb_accountant" ? "FNB_ACCOUNTANT" : roleCode === "fnb_staff" ? "FNB_STORE_STAFF" : "SUPTHAVEE_STAFF"),
    allowed_workspaces: row?.allowed_workspaces ?? (superEmail ? ["supthavee", "fnb", "agri", "prop", "holding"] : roleCode === "fnb_staff" || roleCode === "fnb_accountant" ? ["fnb"] : ["supthavee"]),
    assigned_brand_code: row?.assigned_brand_code ?? null,
    allowed_branch_codes: row?.allowed_branch_codes ?? [],
    can_view_fnb_reports: row ? row.can_view_fnb_reports === true : superEmail,
    can_view_cost_price: row ? row.can_view_cost_price === true : superEmail,
    username: row?.username ?? email,
    must_change_pin: row?.must_change_pin === true,
    is_hr_manager: row ? row.is_hr_manager === true || row.is_super_admin === true : superEmail,
    hr_allowed_workspaces: row?.hr_allowed_workspaces ?? (superEmail ? ["supthavee", "fnb", "agri", "prop", "holding"] : []),
    hr_allowed_entity_ids: row?.hr_allowed_entity_ids ?? [],
    hr_allowed_brand_codes: row?.hr_allowed_brand_codes ?? (superEmail ? ["LUCKY_CUP", "CHATORN"] : []),
    hr_can_prepare_payroll: row ? row.hr_can_prepare_payroll === true || row.is_super_admin === true : superEmail,
    hr_can_view_exec_private_pay: row ? row.hr_can_view_exec_private_pay === true || row.is_super_admin === true : superEmail,
  });
}

export async function getUserAccessContext(userId: string): Promise<UserAccessContext | null> {
  try {
    const rpc = await (createClient() as unknown as HoldingRpc)
      .schema("holding")
      .rpc("get_user_access_context", { p_user_id: userId });
    if (!rpc.error && rpc.data) {
      const parsed = parseAccessPayload(rpc.data);
      if (parsed) return { ...parsed, userId: parsed.userId || userId };
    }
  } catch {
    // Fall through to the table read.
  }
  try {
    return await fallbackAccess(userId);
  } catch {
    return null;
  }
}

async function requireActiveContext(): Promise<UserAccessContext> {
  const owner = await requireSessionUserId();
  if (!owner.ok) redirect("/login");
  const ctx = await getUserAccessContext(owner.userId);
  if (!ctx) redirect("/login");
  if (!ctx.isActive) redirect("/login?reason=deactivated");
  return ctx;
}

export async function requireWorkspacePageAccess(workspace: WorkspaceKey): Promise<UserAccessContext> {
  const ctx = await requireActiveContext();
  const path = (await headers()).get("x-pathname") ?? "";
  const target = path ? accessRedirect(path, ctx) : null;
  if (target) redirect(target);
  if (!ctx.isSuperAdmin && !ctx.allowedWorkspaces.includes(workspace)) {
    redirect(ctx.allowedWorkspaces.includes("supthavee") ? "/forbidden" : fnbStaffHome(ctx));
  }
  return ctx;
}

export async function requireFnbExecutiveAccess(): Promise<UserAccessContext> {
  const ctx = await requireActiveContext();
  if (ctx.isSuperAdmin || ctx.canViewFnbReports) return ctx;
  redirect(ctx.allowedWorkspaces.includes("fnb") ? fnbStaffHome(ctx) : "/forbidden");
}

export async function requireFnbDeskAccess(): Promise<UserAccessContext> {
  const ctx = await requireActiveContext();
  if (ctx.isSuperAdmin || ctx.workspaceRole === "FNB_BRANCH_MANAGER") return ctx;
  redirect(ctx.allowedWorkspaces.includes("fnb") ? fnbStaffHome(ctx) : "/forbidden");
}

export async function requireFnbProcurementOffice(): Promise<UserAccessContext> {
  const ctx = await requireActiveContext();
  if (ctx.isSuperAdmin || ctx.workspaceRole === "FNB_ACCOUNTANT" || ctx.workspaceRole === "FNB_HR_ACCOUNTANT") return ctx;
  redirect(ctx.allowedWorkspaces.includes("fnb") ? fnbStaffHome(ctx) : "/forbidden");
}

export async function requireFnbPeopleAccess(): Promise<UserAccessContext> {
  const ctx = await requireActiveContext();
  const hrDesk = ctx.workspaceRole === "FNB_HR" || ctx.workspaceRole === "FNB_HR_ACCOUNTANT" || (ctx.isHrManager && ctx.hrAllowedWorkspaces.includes("fnb"));
  if (ctx.isSuperAdmin || (hrDesk && ctx.allowedWorkspaces.includes("fnb"))) return ctx;
  redirect(ctx.allowedWorkspaces.includes("fnb") ? fnbStaffHome(ctx) : "/forbidden");
}

export async function requireFnbStoreOperationAccess(branchCode?: string): Promise<
  | { ok: true; userId: string; displayActorName: string; ctx: UserAccessContext }
  | { ok: false; error: string }
> {
  const owner = await requireSessionUserId();
  if (!owner.ok) return { ok: false, error: "กรุณาเข้าสู่ระบบ" };
  const ctx = await getUserAccessContext(owner.userId);
  if (!ctx || !ctx.isActive) return { ok: false, error: "บัญชีนี้ถูกระงับสิทธิ์การใช้งานแล้ว" };
  if (!ctx.isSuperAdmin && !ctx.allowedWorkspaces.includes("fnb")) {
    return { ok: false, error: "ไม่มีสิทธิ์เข้าธุรกิจร้านน้ำ" };
  }
  const code = String(branchCode ?? "").trim();
  const silo = !ctx.isSuperAdmin && (ctx.workspaceRole === "FNB_STORE_STAFF" || ctx.workspaceRole === "FNB_BRANCH_MANAGER");
  if (!ctx.isSuperAdmin && code && ctx.allowedBranchCodes.length > 0 && !ctx.allowedBranchCodes.includes(code)) {
    return { ok: false, error: "ไม่มีสิทธิ์บันทึกข้อมูลของสาขานี้" };
  }
  const brandLimit = new Set(ctx.hrAllowedBrandCodes);
  if (ctx.assignedBrandCode) brandLimit.add(ctx.assignedBrandCode);
  if (!ctx.isSuperAdmin && code && (silo || brandLimit.size > 0)) {
    const branch = await schemaAdmin()
      .schema("fnb")
      .from("branches")
      .select("brand_code")
      .eq("branch_code", code)
      .maybeSingle();
    const brand = (branch.data as { brand_code?: string } | null)?.brand_code ?? "";
    if (brandLimit.size > 0 && !brandLimit.has(brand as "LUCKY_CUP" | "CHATORN")) {
      return { ok: false, error: "ไม่มีสิทธิ์ข้ามแบรนด์ร้านน้ำ" };
    }
  }
  return { ok: true, userId: ctx.userId, displayActorName: ctx.displayActorName, ctx };
}

export async function getSuperAdminStatus(
  userId: string,
  fullName?: string | null,
): Promise<boolean> {
  const ctx = await getUserAccessContext(userId);
  if (ctx) return ctx.isSuperAdmin;
  return nameMatches(fullName);
}

export async function requireSuperAdmin(): Promise<{ userId: string }> {
  const owner = await requireSessionUserId();
  if (!owner.ok) redirect("/login");
  const allowed = await getSuperAdminStatus(owner.userId);
  if (!allowed) redirect("/forbidden");
  return { userId: owner.userId };
}
