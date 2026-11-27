"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireSuperAdmin } from "@/lib/holding/workspace-access";
import { createClient } from "@/lib/supabase/server-admin";
import type { HoldingPeopleHub, HrDelegationInput, IamAuditRow, IamDirectoryRow } from "@/types/iam";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)).filter(Boolean) : [];
}

async function audit(action: string, actorId: string, targetId: string | null, targetName: string, details: Record<string, unknown>) {
  await schemaAdmin().schema("holding").from("iam_hr_audit_logs").insert({
    workspace_key: "holding",
    action_type: action,
    actor_user_id: actorId,
    actor_name: "Super Admin",
    target_user_id: targetId,
    target_name: targetName,
    details_json: details,
  });
}

export async function getHoldingPeopleHubAction(): Promise<{ data: HoldingPeopleHub | null; error: string | null }> {
  try {
    await requireSuperAdmin();
    const [grants, profiles, entities, employees, audits] = await Promise.all([
      schemaAdmin().schema("holding").from("user_workspace_grants").select("user_id, username, staff_nickname, workspace_role, primary_workspace, assigned_brand_code, allowed_branch_codes, is_hr_manager, hr_allowed_workspaces, hr_allowed_entity_ids, hr_allowed_brand_codes, hr_can_prepare_payroll, hr_can_view_exec_private_pay, must_change_pin, last_login_at, is_active, is_super_admin"),
      schemaAdmin().from("user_profiles").select("id, email, full_name, is_active"),
      schemaAdmin().schema("holding").from("legal_entities").select("id, entity_name_th").order("entity_name_th", { ascending: true }),
      schemaAdmin().schema("fnb").from("employees").select("emp_code, user_id, username"),
      schemaAdmin().schema("holding").from("iam_hr_audit_logs").select("id, created_at, actor_name, action_type, target_name, workspace_key").order("created_at", { ascending: false }).limit(80),
    ]);
    const peopleById = new Map((Array.isArray(profiles.data) ? profiles.data as Record<string, unknown>[] : []).map((row) => [text(row.id), row]));
    const directory: IamDirectoryRow[] = (Array.isArray(grants.data) ? grants.data as Record<string, unknown>[] : []).map((row) => {
      const person = peopleById.get(text(row.user_id));
      return {
        userId: text(row.user_id),
        fullName: text(person?.full_name),
        nickname: text(row.staff_nickname),
        username: text(row.username),
        email: text(person?.email),
        workspaceRole: text(row.workspace_role),
        primaryWorkspace: text(row.primary_workspace),
        brandCode: text(row.assigned_brand_code) || null,
        branchCodes: texts(row.allowed_branch_codes),
        isHrManager: row.is_hr_manager === true,
        hrWorkspaces: texts(row.hr_allowed_workspaces),
        hrEntities: texts(row.hr_allowed_entity_ids),
        hrBrands: texts(row.hr_allowed_brand_codes),
        hrCanPreparePayroll: row.hr_can_prepare_payroll === true,
        hrCanViewExecPrivatePay: row.hr_can_view_exec_private_pay === true,
        mustChangePin: row.must_change_pin === true,
        lastLoginAt: row.last_login_at ? text(row.last_login_at) : null,
        isActive: row.is_active !== false && person?.is_active !== false,
      };
    });
    const choltirat = (Array.isArray(employees.data) ? employees.data as Record<string, unknown>[] : []).find((row) => text(row.emp_code) === "LC-HQ-001");
    const auditRows: IamAuditRow[] = (Array.isArray(audits.data) ? audits.data as Record<string, unknown>[] : []).map((row) => ({
      id: text(row.id),
      createdAt: text(row.created_at),
      actorName: text(row.actor_name),
      actionType: text(row.action_type),
      targetName: text(row.target_name),
      workspaceKey: text(row.workspace_key),
    }));
    return {
      data: {
        choltiratLinked: Boolean(choltirat?.user_id),
        entities: (Array.isArray(entities.data) ? entities.data as Record<string, unknown>[] : []).map((row) => ({ id: text(row.id), name: text(row.entity_name_th) })),
        people: directory,
        audits: auditRows,
      },
      error: null,
    };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { data: null, error: err instanceof Error ? err.message : "โหลดศูนย์บุคลากรไม่สำเร็จ" };
  }
}

export async function provisionCholtiratAction(): Promise<{ success: boolean; error?: string }> {
  try {
    const actor = await requireSuperAdmin();
    const employee = await schemaAdmin().schema("fnb").from("employees").select("id, user_id, nickname, full_name_th").eq("emp_code", "LC-HQ-001").maybeSingle();
    const row = employee.data as { id?: string; user_id?: string | null; nickname?: string | null; full_name_th?: string | null } | null;
    if (!row?.id) return { success: false, error: "ไม่พบพนักงาน LC-HQ-001" };
    if (row.user_id) return { success: false, error: "คุณจวงมีรหัสล็อกอินแล้ว" };
    const admin = createClient();
    const created = await admin.auth.admin.createUser({
      email: "choltirat.pan@jasmineplus.local",
      password: "555555",
      email_confirm: true,
      user_metadata: { full_name: row.full_name_th || "นาง ชลธิรัตน์ ปัญญานุชิต", role_code: "fnb_hr_accountant" },
    });
    if (created.error || !created.data.user?.id) return { success: false, error: created.error?.message ?? "สร้างบัญชีไม่สำเร็จ" };
    const userId = created.data.user.id;
    const profile = await admin.from("user_profiles").insert({
      id: userId,
      email: "choltirat.pan@jasmineplus.local",
      full_name: row.full_name_th || "นาง ชลธิรัตน์ ปัญญานุชิต",
      role_code: "fnb_hr_accountant",
      is_active: true,
      pin_code: "555555",
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
      username: "choltirat.pan",
      first_name_en: "Choltirat",
      last_name_en: "Panyanuchit",
      must_change_pin: true,
      is_super_admin: false,
      primary_workspace: "fnb",
      workspace_role: "FNB_HR_ACCOUNTANT",
      allowed_workspaces: ["fnb"],
      assigned_brand_code: "LUCKY_CUP",
      allowed_branch_codes: ["LC-HDY", "LC-PSU"],
      staff_nickname: row.nickname || "คุณจวง",
      is_hr_manager: true,
      hr_allowed_workspaces: ["fnb"],
      hr_allowed_brand_codes: ["LUCKY_CUP"],
      hr_can_prepare_payroll: true,
      hr_can_view_exec_private_pay: false,
      can_view_fnb_reports: false,
      can_view_cost_price: false,
      is_active: true,
    });
    if (grant.error) {
      await admin.from("user_profiles").delete().eq("id", userId);
      await admin.auth.admin.deleteUser(userId);
      return { success: false, error: grant.error.message ?? "บันทึกสิทธิ์ไม่สำเร็จ" };
    }
    await schemaAdmin().schema("fnb").from("employees").update({ user_id: userId, username: "choltirat.pan", has_system_login: true }).eq("id", row.id);
    await audit("PROVISION_LOGIN", actor.userId, userId, row.full_name_th || "คุณจวง", { username: "choltirat.pan" });
    revalidatePath("/holding/people");
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "เปิดใช้งานคุณจวงไม่สำเร็จ" };
  }
}

export async function updateHrDelegationAction(input: HrDelegationInput): Promise<{ success: boolean; error?: string }> {
  try {
    const actor = await requireSuperAdmin();
    const current = await schemaAdmin().schema("holding").from("user_workspace_grants").select("is_super_admin").eq("user_id", input.userId).maybeSingle();
    if ((current.data as { is_super_admin?: boolean } | null)?.is_super_admin) {
      return { success: false, error: "ไม่สามารถเปลี่ยนสิทธิ์ Super Admin จากหน้านี้" };
    }
    const workspaces = input.hrWorkspaces.filter((item) => ["supthavee", "fnb", "agri", "prop", "holding"].includes(item));
    const brands = input.hrBrands.filter((item) => item === "LUCKY_CUP" || item === "CHATORN");
    const saved = await schemaAdmin().schema("holding").from("user_workspace_grants").update({
      is_hr_manager: input.isHrManager,
      hr_allowed_workspaces: workspaces,
      hr_allowed_entity_ids: input.hrEntities,
      hr_allowed_brand_codes: brands,
      hr_can_prepare_payroll: input.hrCanPreparePayroll,
      hr_can_view_exec_private_pay: input.hrCanViewExecPrivatePay,
    }).eq("user_id", input.userId);
    if (saved.error) return { success: false, error: saved.error.message ?? "บันทึกสิทธิ์ HR ไม่สำเร็จ" };
    await audit("HR_SCOPE_UPDATED", actor.userId, input.userId, input.userId, {
      isHrManager: input.isHrManager,
      workspaces,
      brands,
      payroll: input.hrCanPreparePayroll,
      privatePay: input.hrCanViewExecPrivatePay,
    });
    revalidatePath("/holding/people");
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "บันทึกสิทธิ์ HR ไม่สำเร็จ" };
  }
}
