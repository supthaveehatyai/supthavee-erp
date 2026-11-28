"use server";

import { revalidatePath } from "next/cache";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import { payrollAmounts } from "@/lib/fnb/payroll-math";
import { schemaAdmin } from "@/lib/holding/schema-db";
import { requireFnbPeopleAccess } from "@/lib/holding/workspace-access";
import { createClient } from "@/lib/supabase/server-admin";
import type { UserAccessContext } from "@/types/holding";
import {
  fnbGuardrailPermissionsFrom,
  fnbModulePermissionsFrom,
  type FnbGuardrailPermissions,
  type FnbModulePermissions,
  type FnbRolePermissionRow,
} from "@/types/fnb";
import type { FnbEmployeeCard, FnbPayrollBundle, FnbPayrollDraftLine, FnbPeoplePayload } from "@/types/iam";

const PRIVATE_TIERS = new Set(["EXECUTIVE_CONFIDENTIAL", "INTERNAL_PRIVATE"]);
const JASMINE_CODE = "JASMINE_PLUS";

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function num(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function brandsOf(ctx: UserAccessContext): Array<"LUCKY_CUP" | "CHATORN"> {
  if (ctx.isSuperAdmin) return ["LUCKY_CUP", "CHATORN"];
  const set = new Set<"LUCKY_CUP" | "CHATORN">();
  for (const brand of ctx.hrAllowedBrandCodes) set.add(brand);
  if (ctx.assignedBrandCode) set.add(ctx.assignedBrandCode);
  return [...set];
}

function canSeePrivatePay(ctx: UserAccessContext): boolean {
  return ctx.isSuperAdmin || ctx.hrCanViewExecPrivatePay;
}

function mapRole(row: Record<string, unknown>): FnbRolePermissionRow {
  return {
    roleCode: text(row.role_code),
    appRoleCode: text(row.app_role_code) || text(row.role_code).toLowerCase(),
    roleNameTh: text(row.role_name_th),
    description: text(row.description),
    isSystemBuiltin: row.is_system_builtin === true,
    isActive: row.is_active !== false,
    modulePermissions: fnbModulePermissionsFrom(row.module_permissions),
    guardrailPermissions: fnbGuardrailPermissionsFrom(row.guardrail_permissions),
    brandCode: text(row.brand_code),
  };
}

async function readFnbRoles(brandCode?: string): Promise<FnbRolePermissionRow[]> {
  const listed = await schemaAdmin().schema("fnb").from("role_permissions").select("role_code, app_role_code, role_name_th, description, is_system_builtin, is_active, module_permissions, guardrail_permissions, sort_order, brand_code").order("sort_order", { ascending: true });
  return (Array.isArray(listed.data) ? listed.data as Record<string, unknown>[] : []).map(mapRole).filter((row) => !brandCode || row.brandCode === brandCode);
}

type FnbRpc = {
  schema: (name: "fnb") => {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
  };
};

export async function listFnbRolePermissionsAction(): Promise<{ data: FnbRolePermissionRow[]; error: string | null }> {
  try {
    await requireFnbPeopleAccess();
    return { data: await readFnbRoles(), error: null };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { data: [], error: err instanceof Error ? err.message : "อ่านสิทธิ์บทบาทไม่สำเร็จ" };
  }
}

export async function upsertFnbRolePermissionAction(input: {
  roleCode: string;
  roleNameTh: string;
  description?: string;
  brandCode: "LUCKY_CUP" | "CHATORN";
  modulePermissions: FnbModulePermissions;
  guardrailPermissions: FnbGuardrailPermissions;
}): Promise<{ success: boolean; error?: string; roleCode?: string }> {
  try {
    const ctx = await requireFnbPeopleAccess();
    if (!ctx.isSuperAdmin) return { success: false, error: "เฉพาะผู้บริหารสูงสุด (Super Admin) เท่านั้นที่มีสิทธิ์แก้ไขตารางสิทธิ์ระดับบทบาท" };
    const modules = fnbModulePermissionsFrom(input.modulePermissions);
    const guards = fnbGuardrailPermissionsFrom(input.guardrailPermissions);
    const saved = await (createClient() as unknown as FnbRpc).schema("fnb").rpc("upsert_fnb_role_permission", {
      p_actor_user_id: ctx.userId,
      p_brand_code: input.brandCode,
      p_role_code: input.roleCode,
      p_role_name_th: input.roleNameTh,
      p_description: input.description ?? input.roleNameTh,
      p_module_permissions: modules,
      p_guardrail_permissions: guards,
    });
    if (saved.error) return { success: false, error: saved.error.message ?? "อัปเดตสิทธิ์บทบาทไม่สำเร็จ" };
    const body = saved.data as { ok?: boolean; error?: string; role_code?: string } | null;
    if (!body?.ok) return { success: false, error: body?.error ?? "อัปเดตสิทธิ์บทบาทไม่สำเร็จ" };
    revalidatePath("/fnb/people");
    return { success: true, roleCode: text(body.role_code) };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "อัปเดตสิทธิ์บทบาทไม่สำเร็จ" };
  }
}

async function audit(ctx: UserAccessContext, action: string, targetName: string, details: Record<string, unknown>) {
  await schemaAdmin().schema("holding").from("iam_hr_audit_logs").insert({
    workspace_key: "fnb",
    action_type: action,
    actor_user_id: ctx.userId,
    actor_name: ctx.displayActorName,
    target_name: targetName,
    details_json: details,
  });
}

async function jasmineId(): Promise<string | null> {
  const listed = await schemaAdmin().schema("holding").from("legal_entities").select("id, entity_code").eq("entity_code", JASMINE_CODE).maybeSingle();
  return text((listed.data as { id?: string } | null)?.id) || null;
}

async function usernameFor(first: string, last: string, exclude: string | null): Promise<string> {
  const rpc = await (createClient() as unknown as {
    schema: (name: "holding") => {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message?: string } | null }>;
    };
  }).schema("holding").rpc("generate_unique_username", {
    p_first_en: first,
    p_last_en: last,
    p_exclude_user_id: exclude,
  });
  return text(rpc.data).toLowerCase();
}

export async function getFnbPeoplePayloadAction(activeBrand?: string): Promise<{ data: FnbPeoplePayload | null; error: string | null }> {
  try {
    const ctx = await requireFnbPeopleAccess();
    const allowed = brandsOf(ctx);
    const picked = activeBrand === "CHATORN" || activeBrand === "LUCKY_CUP" ? activeBrand : allowed[0] ?? "LUCKY_CUP";
    const brands = allowed.includes(picked) || ctx.isSuperAdmin ? [picked] : allowed.slice(0, 1);
    const [branches, employees] = await Promise.all([
      schemaAdmin().schema("fnb").from("branches").select("branch_code, branch_name_th, brand_code, branch_status").neq("branch_status", "INACTIVE").order("sort_order", { ascending: true }),
      schemaAdmin().schema("fnb").from("employees").select("id, emp_code, user_id, full_name_th, nickname, first_name_en, last_name_en, username, brand_code, primary_branch_code, allowed_branch_codes, hire_date, employment_type, compensation_tier, base_pay_rate, position_allowance, diligence_allowance_default, is_sso_enrolled, bank_account_no, has_system_login, employment_status, system_role").eq("employment_status", "ACTIVE").order("emp_code", { ascending: true }),
    ]);
    const seePrivate = canSeePrivatePay(ctx);
    const cards: FnbEmployeeCard[] = (Array.isArray(employees.data) ? employees.data as Record<string, unknown>[] : [])
      .filter((row) => brands.includes(text(row.brand_code) as "LUCKY_CUP"))
      .filter((row) => seePrivate || !PRIVATE_TIERS.has(text(row.compensation_tier)) || text(row.user_id) === ctx.userId)
      .map((row) => {
        const hidePay = !seePrivate && (PRIVATE_TIERS.has(text(row.compensation_tier)) || text(row.user_id) === ctx.userId && PRIVATE_TIERS.has(text(row.compensation_tier)));
        const selfPrivate = !seePrivate && text(row.user_id) === ctx.userId && PRIVATE_TIERS.has(text(row.compensation_tier));
        return {
          id: text(row.id),
          empCode: text(row.emp_code),
          fullNameTh: text(row.full_name_th),
          nickname: text(row.nickname),
          firstNameEn: text(row.first_name_en),
          lastNameEn: text(row.last_name_en),
          username: text(row.username) || null,
          brandCode: text(row.brand_code),
          primaryBranchCode: text(row.primary_branch_code),
          allowedBranchCodes: Array.isArray(row.allowed_branch_codes) ? row.allowed_branch_codes.map((item) => text(item)) : [],
          hireDate: text(row.hire_date),
          employmentType: text(row.employment_type),
          compensationTier: selfPrivate ? "GENERAL_STAFF" : text(row.compensation_tier),
          basePayRate: hidePay ? null : num(row.base_pay_rate),
          positionAllowance: hidePay ? null : num(row.position_allowance),
          diligenceAllowance: hidePay ? null : num(row.diligence_allowance_default),
          isSsoEnrolled: row.is_sso_enrolled !== false,
          bankAccountNo: hidePay ? null : text(row.bank_account_no) || null,
          hasSystemLogin: row.has_system_login === true,
          userId: text(row.user_id) || null,
          employmentStatus: text(row.employment_status),
          hidePay,
          systemRole: text(row.system_role) || "FNB_STORE_STAFF",
        };
      });
    const roles = await readFnbRoles(brands[0]);
    return {
      data: {
        brands,
        branches: (Array.isArray(branches.data) ? branches.data as Record<string, unknown>[] : [])
          .filter((row) => brands.includes(text(row.brand_code) as "LUCKY_CUP"))
          .map((row) => ({ code: text(row.branch_code), name: text(row.branch_name_th), brand: text(row.brand_code) })),
        employees: cards,
        canSetTier: seePrivate,
        canApprovePayroll: ctx.isSuperAdmin || ctx.fnbGuardrailPermissions.can_approve_financial_edits,
        canEditRolePermissions: ctx.isSuperAdmin,
        actorName: ctx.displayActorName,
        roles,
      },
      error: null,
    };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { data: null, error: err instanceof Error ? err.message : "โหลดทะเบียนพนักงานไม่สำเร็จ" };
  }
}

export async function previewFnbUsernameAction(firstNameEn: string, lastNameEn: string): Promise<string> {
  await requireFnbPeopleAccess();
  return usernameFor(firstNameEn, lastNameEn, null);
}

export async function saveFnbEmployeeAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireFnbPeopleAccess();
    const brands = brandsOf(ctx);
    const brand = text(formData.get("brand_code"));
    if (brand !== "LUCKY_CUP" && brand !== "CHATORN") return { success: false, error: "เลือกแบรนด์ไม่ถูกต้อง" };
    if (!brands.includes(brand)) return { success: false, error: "ไม่มีสิทธิ์ข้ามแบรนด์ร้านน้ำ" };
    const fullName = text(formData.get("full_name_th"));
    const nickname = text(formData.get("nickname"));
    const first = text(formData.get("first_name_en"));
    const last = text(formData.get("last_name_en"));
    const primary = text(formData.get("primary_branch_code"));
    const allowed = formData.getAll("allowed_branch_codes").map((item) => text(item)).filter(Boolean);
    if (!fullName || !nickname || !first || !last || !primary) return { success: false, error: "กรอกชื่อ ชื่อเล่น ชื่ออังกฤษ และสาขาให้ครบ" };
    if (!allowed.includes(primary)) allowed.unshift(primary);
    const entityId = await jasmineId();
    if (!entityId) return { success: false, error: "ไม่พบบริษัทจัสมิน พลัส" };
    const existingId = text(formData.get("id"));
    const username = await usernameFor(first, last, text(formData.get("user_id")) || null);
    if (!username) return { success: false, error: "สร้างชื่อผู้ใช้ไม่สำเร็จ" };
    const systemRole = text(formData.get("system_role")).toUpperCase() || "FNB_STORE_STAFF";
    if (!/^FNB_[A-Z0-9_]+$/.test(systemRole)) return { success: false, error: "บทบาทต้องขึ้นต้นด้วย FNB_" };
    const roles = await readFnbRoles(brand);
    const chosen = roles.find((role) => role.roleCode === systemRole && role.isActive);
    if (roles.length > 0 && !chosen) return { success: false, error: "บทบาทนี้ยังไม่เปิดใช้งาน" };
    const tier = canSeePrivatePay(ctx) ? text(formData.get("compensation_tier")) || "GENERAL_STAFF" : "GENERAL_STAFF";
    if (!["GENERAL_STAFF", "EXECUTIVE_CONFIDENTIAL", "INTERNAL_PRIVATE"].includes(tier)) {
      return { success: false, error: "ชั้นความลับค่าตอบแทนไม่ถูกต้อง" };
    }
    const employmentType = text(formData.get("employment_type")) || "FULL_TIME_MONTHLY";
    const payload = {
      full_name_th: fullName,
      nickname,
      first_name_en: first,
      last_name_en: last,
      username,
      brand_code: brand,
      primary_branch_code: primary,
      allowed_branch_codes: Array.from(new Set([...allowed, primary])),
      legal_entity_id: entityId,
      hire_date: text(formData.get("hire_date")) || new Date().toISOString().slice(0, 10),
      employment_type: employmentType,
      compensation_tier: tier,
      base_pay_rate: num(formData.get("base_pay_rate")),
      position_allowance: num(formData.get("position_allowance")),
      diligence_allowance_default: num(formData.get("diligence_allowance")),
      is_sso_enrolled: formData.get("is_sso_enrolled") === "true",
      bank_account_no: text(formData.get("bank_account_no")) || null,
      employment_status: "ACTIVE",
      system_role: systemRole,
      updated_at: new Date().toISOString(),
    };
    let employeeId = existingId;
    if (existingId && !canSeePrivatePay(ctx)) {
      const current = await schemaAdmin().schema("fnb").from("employees").select("compensation_tier, base_pay_rate, position_allowance, diligence_allowance_default, bank_account_no").eq("id", existingId).maybeSingle();
      const kept = current.data as Record<string, unknown> | null;
      if (kept && PRIVATE_TIERS.has(text(kept.compensation_tier))) {
        payload.compensation_tier = text(kept.compensation_tier);
        payload.base_pay_rate = num(kept.base_pay_rate);
        payload.position_allowance = num(kept.position_allowance);
        payload.diligence_allowance_default = num(kept.diligence_allowance_default);
        payload.bank_account_no = text(kept.bank_account_no) || null;
      }
    }
    if (existingId) {
      const saved = await schemaAdmin().schema("fnb").from("employees").update(payload).eq("id", existingId);
      if (saved.error) return { success: false, error: saved.error.message ?? "บันทึกพนักงานไม่สำเร็จ" };
    } else {
      employeeId = crypto.randomUUID();
      const saved = await schemaAdmin().schema("fnb").from("employees").insert({
        ...payload,
        id: employeeId,
        emp_code: `LC-STF-${Date.now().toString().slice(-6)}`,
        has_system_login: false,
      });
      if (saved.error) return { success: false, error: saved.error.message ?? "สร้างพนักงานไม่สำเร็จ" };
    }
    await storePrivateFile(employeeId, "idcard", formData.get("id_card"));
    await storePrivateFile(employeeId, "bankbook", formData.get("bank_book"));
    let linkedUser = text(formData.get("user_id"));
    if (!linkedUser && existingId) {
      const currentUser = await schemaAdmin().schema("fnb").from("employees").select("user_id").eq("id", existingId).maybeSingle();
      linkedUser = text((currentUser.data as { user_id?: string } | null)?.user_id);
    }
    const branchCodes = Array.from(new Set([...allowed, primary]));
    if (linkedUser) {
      await syncWorkspaceGrant(linkedUser, username, nickname, brand, systemRole, branchCodes);
      await createClient().from("user_profiles").update({ role_code: chosen?.appRoleCode || systemRole.toLowerCase(), updated_at: new Date().toISOString() }).eq("id", linkedUser);
    }
    if (formData.get("open_login") === "true") {
      const opened = await ensureLogin(ctx, employeeId, username, fullName, nickname, brand, primary, branchCodes, text(payload.hire_date), systemRole, chosen?.appRoleCode || systemRole.toLowerCase());
      if (!opened.success) return opened;
    }
    await audit(ctx, "EMPLOYEE_SAVED", fullName, { employeeId, username, brand });
    revalidatePath("/fnb/people");
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "บันทึกพนักงานไม่สำเร็จ" };
  }
}

async function syncWorkspaceGrant(userId: string, username: string, nickname: string, brand: string, role: string, branches: string[]) {
  const codes = Array.from(new Set(branches.filter(Boolean)));
  const patch = {
    allowed_branch_codes: codes,
    assigned_brand_code: brand,
    staff_nickname: nickname,
    workspace_role: role,
  };
  const existing = await schemaAdmin().schema("holding").from("user_workspace_grants").select("user_id").eq("user_id", userId).maybeSingle();
  if (existing.data) {
    await schemaAdmin().schema("holding").from("user_workspace_grants").update(patch).eq("user_id", userId);
    return;
  }
  await schemaAdmin().schema("holding").from("user_workspace_grants").insert({
    user_id: userId,
    username,
    must_change_pin: false,
    is_super_admin: false,
    primary_workspace: "fnb",
    allowed_workspaces: ["fnb"],
    is_active: true,
    can_view_fnb_reports: false,
    can_view_cost_price: false,
    hr_can_view_exec_private_pay: false,
    ...patch,
  });
}

async function storePrivateFile(employeeId: string, kind: "idcard" | "bankbook", value: FormDataEntryValue | null) {
  if (!(value instanceof File) || value.size === 0) return;
  const ext = (value.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
  const path = `hr/${employeeId}/${kind}_${crypto.randomUUID()}.${ext}`;
  const uploaded = await schemaAdmin().storage.from("hr_private_docs").upload(path, Buffer.from(await value.arrayBuffer()), {
    contentType: value.type || "application/octet-stream",
    upsert: false,
  });
  if (uploaded.error) return;
  await schemaAdmin().schema("fnb").from("employees").update({
    [kind === "idcard" ? "id_card_storage_path" : "bank_book_storage_path"]: path,
  }).eq("id", employeeId);
}

async function ensureLogin(
  ctx: UserAccessContext,
  employeeId: string,
  username: string,
  fullName: string,
  nickname: string,
  brand: string,
  primary: string,
  allowed: string[],
  hireDate: string,
  systemRole: string,
  appRoleCode: string,
): Promise<{ success: boolean; error?: string }> {
  const existing = await schemaAdmin().schema("fnb").from("employees").select("user_id").eq("id", employeeId).maybeSingle();
  if (text((existing.data as { user_id?: string } | null)?.user_id)) return { success: true };
  const email = `${username}@${brand === "CHATORN" ? "chatorn.local" : "luckycup.local"}`;
  const admin = createClient();
  const created = await admin.auth.admin.createUser({
    email,
    password: "555555",
    email_confirm: true,
    user_metadata: { full_name: fullName, role_code: appRoleCode },
  });
  if (created.error || !created.data.user?.id) return { success: false, error: created.error?.message ?? "เปิดรหัสล็อกอินไม่สำเร็จ" };
  const userId = created.data.user.id;
  const profile = await admin.from("user_profiles").insert({
    id: userId,
    email,
    full_name: fullName,
    role_code: appRoleCode,
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
    username,
    must_change_pin: true,
    is_super_admin: false,
    primary_workspace: "fnb",
    workspace_role: systemRole,
    allowed_workspaces: ["fnb"],
    assigned_brand_code: brand,
    allowed_branch_codes: Array.from(new Set([...allowed, primary])),
    staff_nickname: nickname,
    start_work_date: hireDate,
    is_active: true,
    can_view_fnb_reports: false,
    can_view_cost_price: false,
    hr_can_view_exec_private_pay: false,
  });
  if (grant.error) {
    await admin.from("user_profiles").delete().eq("id", userId);
    await admin.auth.admin.deleteUser(userId);
    return { success: false, error: grant.error.message ?? "บันทึกสิทธิ์ล็อกอินไม่สำเร็จ" };
  }
  await schemaAdmin().schema("fnb").from("employees").update({ user_id: userId, has_system_login: true, username }).eq("id", employeeId);
  await audit(ctx, "PROVISION_LOGIN", fullName, { username, employeeId });
  return { success: true };
}

export async function resetFnbEmployeePinAction(employeeId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireFnbPeopleAccess();
    const employee = await ownedEmployee(ctx, employeeId);
    if (!employee.userId) return { success: false, error: "พนักงานคนนี้ยังไม่มีรหัสล็อกอิน" };
    const admin = createClient();
    const auth = await admin.auth.admin.updateUserById(employee.userId, { password: "555555", email_confirm: true });
    if (auth.error) return { success: false, error: auth.error.message };
    await admin.from("user_profiles").update({ pin_code: "555555", updated_at: new Date().toISOString() }).eq("id", employee.userId);
    await schemaAdmin().schema("holding").from("user_workspace_grants").update({ must_change_pin: true, pin_changed_at: null }).eq("user_id", employee.userId);
    await audit(ctx, "PIN_RESET", employee.name, { employeeId });
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "รีเซ็ต PIN ไม่สำเร็จ" };
  }
}

export async function resignFnbEmployeeAction(employeeId: string, resignedDate: string, reason: string): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireFnbPeopleAccess();
    if (!resignedDate || !text(reason)) return { success: false, error: "ระบุวันลาออกและสาเหตุ" };
    const employee = await ownedEmployee(ctx, employeeId);
    await schemaAdmin().schema("fnb").from("employees").update({
      employment_status: "RESIGNED",
      resigned_date: resignedDate,
      resignation_reason: text(reason),
      has_system_login: false,
    }).eq("id", employeeId);
    if (employee.userId) {
      await createClient().from("user_profiles").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", employee.userId);
      await schemaAdmin().schema("holding").from("user_workspace_grants").update({
        is_active: false,
        deactivated_at: new Date().toISOString(),
        deactivation_reason: text(reason),
      }).eq("user_id", employee.userId);
      await createClient().auth.admin.updateUserById(employee.userId, { ban_duration: "876000h" });
    }
    await audit(ctx, "RESIGN", employee.name, { employeeId, resignedDate, reason: text(reason) });
    revalidatePath("/fnb/people");
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "บันทึกลาออกไม่สำเร็จ" };
  }
}

export async function openPrivateDocAction(employeeId: string, kind: "idcard" | "bankbook"): Promise<{ url: string | null; error: string | null }> {
  try {
    const ctx = await requireFnbPeopleAccess();
    const employee = await ownedEmployee(ctx, employeeId);
    const column = kind === "idcard" ? "id_card_storage_path" : "bank_book_storage_path";
    const listed = await schemaAdmin().schema("fnb").from("employees").select(column).eq("id", employeeId).maybeSingle();
    const path = text((listed.data as Record<string, unknown> | null)?.[column]);
    if (!path) return { url: null, error: "ยังไม่มีไฟล์นี้" };
    const signed = await schemaAdmin().storage.from("hr_private_docs").createSignedUrl(path, 120);
    if (!signed.data?.signedUrl) return { url: null, error: signed.error?.message ?? "เปิดไฟล์ไม่สำเร็จ" };
    await audit(ctx, kind === "idcard" ? "VIEW_ID_CARD" : "VIEW_BANK_BOOK", employee.name, { employeeId });
    return { url: signed.data.signedUrl, error: null };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { url: null, error: err instanceof Error ? err.message : "เปิดไฟล์ไม่สำเร็จ" };
  }
}

async function ownedEmployee(ctx: UserAccessContext, employeeId: string): Promise<{ userId: string | null; name: string; brand: string; tier: string }> {
  const listed = await schemaAdmin().schema("fnb").from("employees").select("user_id, full_name_th, brand_code, compensation_tier").eq("id", employeeId).maybeSingle();
  const row = listed.data as { user_id?: string | null; full_name_th?: string; brand_code?: string; compensation_tier?: string } | null;
  if (!row) throw new Error("ไม่พบพนักงาน");
  if (!brandsOf(ctx).includes(text(row.brand_code) as "LUCKY_CUP")) throw new Error("ไม่มีสิทธิ์ข้ามแบรนด์ร้านน้ำ");
  if (!canSeePrivatePay(ctx) && PRIVATE_TIERS.has(text(row.compensation_tier)) && text(row.user_id) !== ctx.userId) {
    throw new Error("ไม่มีสิทธิ์ดูข้อมูลค่าตอบแทนระดับนี้");
  }
  return { userId: text(row.user_id) || null, name: text(row.full_name_th), brand: text(row.brand_code), tier: text(row.compensation_tier) };
}

export async function loadFnbPayrollAction(year: number, month: number, brandCode: "LUCKY_CUP" | "CHATORN"): Promise<{ data: FnbPayrollBundle | null; error: string | null }> {
  try {
    const ctx = await requireFnbPeopleAccess();
    if (!brandsOf(ctx).includes(brandCode)) return { data: null, error: "ไม่มีสิทธิ์แบรนด์นี้" };
    const entityId = await jasmineId();
    if (!entityId) return { data: null, error: "ไม่พบบริษัทจัสมิน พลัส" };
    const seePrivate = canSeePrivatePay(ctx);
    const employees = await schemaAdmin().schema("fnb").from("employees").select("id, full_name_th, nickname, employment_type, compensation_tier, base_pay_rate, diligence_allowance_default, position_allowance, is_sso_enrolled, primary_branch_code, employment_status, brand_code").eq("brand_code", brandCode).eq("employment_status", "ACTIVE");
    const staff = (Array.isArray(employees.data) ? employees.data as Record<string, unknown>[] : []).filter((row) => seePrivate || text(row.compensation_tier) === "GENERAL_STAFF");
    const period = await schemaAdmin().schema("fnb").from("payroll_periods").select("id, status").eq("legal_entity_id", entityId).eq("brand_code", brandCode).eq("period_year", year).eq("period_month", month).maybeSingle();
    const periodRow = period.data as { id?: string; status?: string } | null;
    const items = periodRow?.id
      ? await schemaAdmin().schema("fnb").from("payroll_items").select("employee_id, hours_or_days_worked, ot_pay, sales_commission, diligence_bonus, position_allowance, other_deduction").eq("period_id", periodRow.id)
      : { data: [] };
    const saved = new Map((Array.isArray(items.data) ? items.data as Record<string, unknown>[] : []).map((row) => [text(row.employee_id), row]));
    const lines: FnbPayrollDraftLine[] = staff.map((row) => {
      const prior = saved.get(text(row.id));
      return {
        employeeId: text(row.id),
        name: `${text(row.nickname) || text(row.full_name_th)}`,
        employmentType: text(row.employment_type),
        baseRate: num(row.base_pay_rate),
        isSso: row.is_sso_enrolled !== false,
        hoursOrDays: prior ? num(prior.hours_or_days_worked) : text(row.employment_type) === "FULL_TIME_MONTHLY" ? 1 : 0,
        otPay: prior ? num(prior.ot_pay) : 0,
        salesCommission: prior ? num(prior.sales_commission) : 0,
        diligenceBonus: prior ? num(prior.diligence_bonus) : num(row.diligence_allowance_default),
        positionAllowance: prior ? num(prior.position_allowance) : num(row.position_allowance),
        otherDeduction: prior ? num(prior.other_deduction) : 0,
        branchCode: text(row.primary_branch_code) || "LC-HDY",
        compensationTier: text(row.compensation_tier) || "GENERAL_STAFF",
      };
    });
    return { data: { periodId: periodRow?.id ?? null, status: periodRow?.status ?? "DRAFT_HR", lines }, error: null };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { data: null, error: err instanceof Error ? err.message : "โหลดงวดเงินเดือนไม่สำเร็จ" };
  }
}

export async function submitFnbPayrollAction(input: { year: number; month: number; brandCode: "LUCKY_CUP" | "CHATORN"; lines: FnbPayrollDraftLine[] }): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireFnbPeopleAccess();
    if (!ctx.isSuperAdmin && !ctx.hrCanPreparePayroll) return { success: false, error: "ไม่มีสิทธิ์เตรียมเงินเดือน" };
    if (!brandsOf(ctx).includes(input.brandCode)) return { success: false, error: "ไม่มีสิทธิ์แบรนด์นี้" };
    const entityId = await jasmineId();
    if (!entityId) return { success: false, error: "ไม่พบบริษัทจัสมิน พลัส" };
    const loaded = await loadFnbPayrollAction(input.year, input.month, input.brandCode);
    if (!loaded.data) return { success: false, error: loaded.error ?? "โหลดงวดไม่สำเร็จ" };
    if (loaded.data.status === "APPROVED_LOCKED" || loaded.data.status === "PAID") return { success: false, error: "งวดนี้ถูกล็อกแล้ว" };
    const allowed = new Map(loaded.data.lines.map((line) => [line.employeeId, line]));
    let periodId = loaded.data.periodId;
    if (!periodId) {
      periodId = crypto.randomUUID();
      const created = await schemaAdmin().schema("fnb").from("payroll_periods").insert({
        id: periodId,
        legal_entity_id: entityId,
        brand_code: input.brandCode,
        period_year: input.year,
        period_month: input.month,
        status: "SUBMITTED_FOR_APPROVAL",
        prepared_by_name: ctx.displayActorName,
        submitted_at: new Date().toISOString(),
      });
      if (created.error) return { success: false, error: created.error.message ?? "สร้างงวดไม่สำเร็จ" };
    } else {
      await schemaAdmin().schema("fnb").from("payroll_periods").update({
        status: "SUBMITTED_FOR_APPROVAL",
        prepared_by_name: ctx.displayActorName,
        submitted_at: new Date().toISOString(),
      }).eq("id", periodId);
      await schemaAdmin().schema("fnb").from("payroll_items").delete().eq("period_id", periodId);
    }
    const rows = input.lines.filter((line) => allowed.has(line.employeeId)).map((line) => {
      const base = allowed.get(line.employeeId)!;
      const amounts = payrollAmounts({ ...line, baseRate: base.baseRate, employmentType: base.employmentType, isSso: base.isSso });
      return {
        period_id: periodId,
        employee_id: line.employeeId,
        branch_code: base.branchCode || "LC-HDY",
        compensation_tier: base.compensationTier || "GENERAL_STAFF",
        employment_type: base.employmentType,
        base_rate: base.baseRate,
        hours_or_days_worked: line.hoursOrDays,
        calculated_base_pay: amounts.calculatedBase,
        ot_pay: line.otPay,
        sales_commission: line.salesCommission,
        diligence_bonus: line.diligenceBonus,
        position_allowance: line.positionAllowance,
        other_deduction: line.otherDeduction,
        gross_pay: amounts.gross,
        sso_employee_amount: amounts.ssoEmployee,
        sso_employer_amount: amounts.ssoEmployer,
        wht_amount: 0,
        net_pay: amounts.net,
        payout_status: "UNPAID",
      };
    });
    if (rows.length > 0) {
      const inserted = await schemaAdmin().schema("fnb").from("payroll_items").insert(rows);
      if (inserted.error) return { success: false, error: inserted.error.message ?? "บันทึกรายการเงินเดือนไม่สำเร็จ" };
    }
    await audit(ctx, "PAYROLL_SUBMITTED", `${input.brandCode} ${input.year}-${input.month}`, { count: rows.length });
    revalidatePath("/fnb/people");
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "ส่งร่างเงินเดือนไม่สำเร็จ" };
  }
}

export async function approveFnbPayrollAction(periodId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const ctx = await requireFnbPeopleAccess();
    if (!ctx.isSuperAdmin && !ctx.fnbGuardrailPermissions.can_approve_financial_edits) {
      return { success: false, error: "ไม่มีสิทธิ์อนุมัติงวดเงินเดือน" };
    }
    const saved = await schemaAdmin().schema("fnb").from("payroll_periods").update({
      status: "APPROVED_LOCKED",
      approved_by_user_id: ctx.userId,
      approved_by_name: ctx.displayActorName,
      approved_at: new Date().toISOString(),
    }).eq("id", periodId);
    if (saved.error) return { success: false, error: saved.error.message ?? "อนุมัติงวดไม่สำเร็จ" };
    await audit(ctx, "PAYROLL_APPROVED", periodId, {});
    revalidatePath("/fnb/people");
    return { success: true };
  } catch (err) {
    if (isRedirectError(err)) throw err;
    return { success: false, error: err instanceof Error ? err.message : "อนุมัติงวดไม่สำเร็จ" };
  }
}
