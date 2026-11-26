import { normalizePathname } from "@/lib/auth/module-access";
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
  "FNB_STORE_STAFF",
  "FNB_BRANCH_MANAGER",
  "FNB_ACCOUNTANT",
  "PROP_MANAGER",
  "AGRI_MANAGER",
];

const EXECUTIVE_FNB = ["/fnb/analytics", "/fnb/items", "/fnb/menus", "/fnb/sop-settings"];

export function safeInternalPath(value: string | null | undefined): string | null {
  const raw = String(value ?? "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\") || raw.includes("://")) {
    return null;
  }
  const path = raw.split("?")[0]?.split("#")[0] ?? "";
  return path.startsWith("/") ? path : null;
}

export function fnbStaffHome(ctx: Pick<UserAccessContext, "workspaceRole" | "assignedBrandCode">): string {
  if (ctx.workspaceRole === "FNB_ACCOUNTANT") return "/fnb/procurement";
  if (ctx.workspaceRole === "FNB_BRANCH_MANAGER") return "/fnb/operations";
  return ctx.assignedBrandCode === "CHATORN" ? "/liff/chatorn" : "/liff/luckycup";
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

  if (ctx.workspaceRole === "FNB_STORE_STAFF" && fnbPath) return home;
  if (
    ctx.workspaceRole === "FNB_ACCOUNTANT" &&
    fnbPath &&
    path !== "/fnb/procurement" &&
    !path.startsWith("/fnb/procurement/")
  ) {
    return "/fnb/procurement";
  }
  if (isFnbExecutivePath(path) && !ctx.canViewFnbReports) {
    return hasWorkspace(ctx, "fnb") ? home : "/forbidden";
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
  if (ROLES.includes(value as WorkspaceRole)) return value as WorkspaceRole;
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
  };
}
