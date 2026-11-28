import { normalizePathname } from "@/lib/auth/module-access";
import {
  fnbGuardrailPermissionsFrom,
  fnbModulePermissionsFrom,
  type FnbModulePermissionKey,
  type FnbModulePermissions,
} from "@/types/fnb";
import {
  SUPER_ADMIN_EMAIL,
  type UserAccessContext,
  type WorkspaceKey,
  type WorkspaceRole,
} from "@/types/holding";

const WORKSPACES: WorkspaceKey[] = ["supthavee", "fnb", "agri", "prop", "holding"];
const ROLES: WorkspaceRole[] = [
  "SUPER_ADMIN",
  "SUPTHAVEE_STAFF",
  "SUPTHAVEE_HR",
  "FNB_STORE_STAFF",
  "FNB_BRANCH_MANAGER",
  "FNB_ACCOUNTANT",
  "FNB_HR",
  "FNB_HR_ACCOUNTANT",
  "PROP_MANAGER",
  "AGRI_MANAGER",
];

const EXECUTIVE_FNB = ["/fnb/analytics", "/fnb/items", "/fnb/menus", "/fnb/sop-settings"];

export function allowsFnbModule(perms: FnbModulePermissions, key: FnbModulePermissionKey | "procurement"): boolean {
  if (key === "procurement") return perms.goods_receipt_expiry || perms.hq_tax_reimburse;
  return perms[key] === true;
}

export function fnbPermissionForPath(pathname: string): FnbModulePermissionKey | "procurement" | null {
  const path = normalizePathname(pathname);
  if (path.startsWith("/liff/register")) return null;
  if (path.startsWith("/liff/luckycup") || path.startsWith("/liff/chatorn") || path.startsWith("/liff")) return "store_portal";
  if (path === "/fnb" || path.startsWith("/fnb/analytics")) return "all_branch_analytics";
  if (path.startsWith("/fnb/operations")) return "store_portal";
  if (path.startsWith("/fnb/sop-settings")) return "sop_shift_settings";
  if (path.startsWith("/fnb/items") || path.startsWith("/fnb/menus")) return "master_items_bom";
  if (path.startsWith("/fnb/procurement")) return "procurement";
  if (path.startsWith("/fnb/inventory")) return "branch_inventory_transfer";
  if (path.startsWith("/fnb/people")) return "people_payroll";
  if (path === "/fnb" || path.startsWith("/fnb/")) return "all_branch_analytics";
  return null;
}

export function allowsFnbHref(href: string, perms: FnbModulePermissions): boolean {
  const path = href.split("?")[0] ?? href;
  if (path.startsWith("/fnb/audit")) return perms.all_branch_analytics || perms.tax_accounting_reports;
  const key = fnbPermissionForPath(path);
  return key ? allowsFnbModule(perms, key) : false;
}

export function safeInternalPath(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("://")) {
    return null;
  }
  const hashless = raw.split("#")[0] ?? "";
  const splitAt = hashless.indexOf("?");
  const path = splitAt === -1 ? hashless : hashless.slice(0, splitAt);
  const query = splitAt === -1 ? "" : hashless.slice(splitAt);
  return path.startsWith("/") ? `${path}${query}` : null;
}

export function fnbStaffHome(ctx: UserAccessContext): string {
  const brandHome = ctx.assignedBrandCode === "CHATORN" ? "/liff/chatorn" : "/liff/luckycup";
  if (ctx.workspaceRole === "FNB_HR" || ctx.workspaceRole === "FNB_HR_ACCOUNTANT") return "/fnb/people";
  if (ctx.workspaceRole === "FNB_ACCOUNTANT") return "/fnb/procurement";
  if (ctx.workspaceRole === "FNB_STORE_STAFF" || ctx.workspaceRole === "FNB_BRANCH_MANAGER") return brandHome;
  const perms = ctx.fnbModulePermissions ?? fnbModulePermissionsFrom(null);
  if (perms.people_payroll) return "/fnb/people";
  if (perms.goods_receipt_expiry || perms.hq_tax_reimburse) return "/fnb/procurement";
  if (perms.branch_inventory_transfer) return "/fnb/inventory";
  if (perms.all_branch_analytics) return "/fnb";
  if (perms.master_items_bom) return "/fnb/items";
  if (perms.sop_shift_settings) return "/fnb/sop-settings";
  if (perms.store_portal) return brandHome;
  return brandHome;
}

export function homeAfterLogin(ctx: UserAccessContext): string {
  if (ctx.mustChangePin) return "/change-pin";
  if (
    ctx.workspaceRole === "FNB_STORE_STAFF" ||
    ctx.workspaceRole === "FNB_BRANCH_MANAGER" ||
    ctx.workspaceRole === "FNB_ACCOUNTANT" ||
    ctx.workspaceRole === "FNB_HR" ||
    ctx.workspaceRole === "FNB_HR_ACCOUNTANT"
  ) {
    return fnbStaffHome(ctx);
  }
  return "/dashboard";
}

export function canOpenSupthaveeUsers(
  pathname: string,
  ctx: Pick<UserAccessContext, "isSuperAdmin" | "workspaceRole">,
  roleCode: string | null | undefined,
): boolean {
  const path = normalizePathname(pathname);
  if (path !== "/settings/users" && !path.startsWith("/settings/users/")) return false;
  return ctx.isSuperAdmin || ctx.workspaceRole === "SUPTHAVEE_HR" || String(roleCode ?? "").toLowerCase() === "admin";
}

export function isFnbExecutivePath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (path === "/fnb") return true;
  return EXECUTIVE_FNB.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

export function isSupthaveeErpPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (
    path.startsWith("/fnb") ||
    path.startsWith("/holding") ||
    path.startsWith("/property") ||
    path.startsWith("/plantation") ||
    path.startsWith("/liff") ||
    path.startsWith("/login") ||
    path.startsWith("/auth") ||
    path.startsWith("/forbidden") ||
    path.startsWith("/api")
  ) {
    return false;
  }
  return true;
}

function hasWorkspace(ctx: UserAccessContext, workspace: WorkspaceKey): boolean {
  return ctx.allowedWorkspaces.includes(workspace);
}

/** Where to send this user, or null when the current path is allowed. */
export function accessRedirect(pathname: string, ctx: UserAccessContext): string | null {
  const path = normalizePathname(pathname);
  if (!ctx.isActive) return "/login?reason=deactivated";
  if (path === "/change-pin") return ctx.mustChangePin ? null : homeAfterLogin({ ...ctx, mustChangePin: false });
  if (ctx.mustChangePin) return "/change-pin";
  if (ctx.isSuperAdmin) return null;

  const home = fnbStaffHome(ctx);
  if (isSupthaveeErpPath(path) && !hasWorkspace(ctx, "supthavee")) return home;

  if (
    path === "/holding" ||
    path.startsWith("/holding/") ||
    path === "/property" ||
    path.startsWith("/property/") ||
    path === "/plantation" ||
    path.startsWith("/plantation/")
  ) {
    return "/forbidden";
  }

  const fnbPath = path === "/fnb" || path.startsWith("/fnb/");
  const liffPath = path === "/liff" || path.startsWith("/liff/");
  if ((fnbPath || liffPath) && !hasWorkspace(ctx, "fnb")) return "/forbidden";

  if ((fnbPath || liffPath) && !path.startsWith("/liff/register")) {
    const perms = ctx.fnbModulePermissions ?? fnbModulePermissionsFrom(null);
    if (path.startsWith("/fnb/audit")) {
      if (!perms.all_branch_analytics && !perms.tax_accounting_reports) return home;
    } else {
      const needed = fnbPermissionForPath(path);
      if (!needed || !allowsFnbModule(perms, needed)) return home;
    }
  }

  if (path.startsWith("/liff/luckycup") && ctx.assignedBrandCode === "CHATORN") return "/liff/chatorn";
  if (path.startsWith("/liff/chatorn") && ctx.assignedBrandCode === "LUCKY_CUP") return "/liff/luckycup";
  if (
    (path === "/liff" || path.startsWith("/liff/fnb")) &&
    (ctx.workspaceRole === "FNB_STORE_STAFF" || ctx.workspaceRole === "FNB_BRANCH_MANAGER")
  ) {
    return home;
  }
  return null;
}

function asWorkspace(value: unknown): WorkspaceKey {
  return WORKSPACES.includes(value as WorkspaceKey) ? (value as WorkspaceKey) : "supthavee";
}

function asRole(value: unknown, email: string): WorkspaceRole {
  const raw = String(value ?? "").trim().toUpperCase();
  if (ROLES.includes(raw as WorkspaceRole)) return raw as WorkspaceRole;
  if (raw.startsWith("FNB_")) return raw as WorkspaceRole;
  return email.trim().toLowerCase() === SUPER_ADMIN_EMAIL ? "SUPER_ADMIN" : "SUPTHAVEE_STAFF";
}

function asWorkspaces(value: unknown, email: string, roleCode: string): WorkspaceKey[] {
  const source = Array.isArray(value) ? value : [];
  const next = source.filter((item): item is WorkspaceKey => WORKSPACES.includes(item as WorkspaceKey));
  if (next.length > 0) return next;
  if (email.trim().toLowerCase() === SUPER_ADMIN_EMAIL) return [...WORKSPACES];
  if (roleCode === "fnb_staff" || roleCode === "fnb_accountant") return ["fnb"];
  return ["supthavee"];
}

export function parseAccessPayload(raw: unknown): UserAccessContext | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  if (row.found === false) return null;
  const email = String(row.email ?? "").trim().toLowerCase();
  const roleCode = String(row.role_code ?? "").trim().toLowerCase();
  const fullName = String(row.full_name ?? "").trim();
  const branches = Array.isArray(row.allowed_branch_codes)
    ? row.allowed_branch_codes.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [];
  const brand = row.assigned_brand_code === "LUCKY_CUP" || row.assigned_brand_code === "CHATORN"
    ? row.assigned_brand_code
    : null;
  return {
    userId: String(row.user_id ?? ""),
    email,
    fullName,
    displayActorName: String(row.display_actor_name ?? "").trim() || fullName || email,
    roleCode,
    isActive: row.is_active !== false,
    isSuperAdmin: row.is_super_admin === true,
    primaryWorkspace: asWorkspace(row.primary_workspace),
    workspaceRole: asRole(row.workspace_role, email),
    allowedWorkspaces: asWorkspaces(row.allowed_workspaces, email, roleCode),
    assignedBrandCode: brand,
    allowedBranchCodes: branches,
    canViewFnbReports: row.can_view_fnb_reports === true,
    canViewCostPrice: row.can_view_cost_price === true,
    username: String(row.username ?? email),
    mustChangePin: row.must_change_pin === true,
    isHrManager: row.is_hr_manager === true,
    hrAllowedWorkspaces: (Array.isArray(row.hr_allowed_workspaces) ? row.hr_allowed_workspaces : []).filter(
      (item): item is WorkspaceKey => WORKSPACES.includes(item as WorkspaceKey),
    ),
    hrAllowedEntityIds: Array.isArray(row.hr_allowed_entity_ids) ? row.hr_allowed_entity_ids.map((item) => String(item)) : [],
    hrAllowedBrandCodes: Array.isArray(row.hr_allowed_brand_codes)
      ? row.hr_allowed_brand_codes.filter((item): item is "LUCKY_CUP" | "CHATORN" => item === "LUCKY_CUP" || item === "CHATORN")
      : [],
    hrCanPreparePayroll: row.hr_can_prepare_payroll === true,
    hrCanViewExecPrivatePay: row.hr_can_view_exec_private_pay === true,
    fnbModulePermissions: fnbModulePermissionsFrom(null),
    fnbGuardrailPermissions: fnbGuardrailPermissionsFrom(null),
  };
}
