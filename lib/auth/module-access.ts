/**
 * Dynamic RBAC path ↔ module mapping.
 * Safe for Server (Layout / Auth Guard) and Client (nav filter).
 */

import {
  ERP_MODULE_KEYS,
  ERP_MODULE_LABELS,
  type AccessibleModules,
  type ErpModuleKey,
} from "@/types/rbac";

export { ERP_MODULE_KEYS, ERP_MODULE_LABELS };
export type { AccessibleModules, ErpModuleKey };

export const ALL_MODULES_GRANTED: AccessibleModules = {
  sales: true,
  purchases: true,
  inventory: true,
  finance: true,
  settings: true,
};

export const ALL_MODULES_DENIED: AccessibleModules = {
  sales: false,
  purchases: false,
  inventory: false,
  finance: false,
  settings: false,
};

/**
 * Prefixes gated by each module.
 * Example: `/sales/*` requires `accessible_modules.sales === true`.
 */
export const MODULE_PATH_PREFIXES: Record<ErpModuleKey, readonly string[]> = {
  sales: ["/sales"],
  purchases: ["/purchases"],
  inventory: ["/inventory", "/production"],
  finance: [
    "/finance",
    "/expenses",
    "/tax",
    "/accounting-periods",
    "/approvals",
    "/fixed-assets",
  ],
  settings: ["/settings"],
};

/** Login / OAuth callback — skip session guards and never redirect away */
export const AUTH_PATH_PREFIXES = ["/login", "/auth"] as const;

export function isAuthPath(pathname: string): boolean {
  const path = pathname.trim();
  return AUTH_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

const PUBLIC_OR_UNGATED_PREFIXES = [
  ...AUTH_PATH_PREFIXES,
  "/forbidden",
  "/dashboard",
  "/contacts",
  "/products",
  "/knowledge-base",
  "/audit-logs",
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isAdminRoleCode(roleCode: string | null | undefined): boolean {
  return String(roleCode ?? "").trim().toLowerCase() === "admin";
}

/**
 * Parse `app_roles.accessible_modules` JSONB.
 * Admin always receives full access. Null/legacy JSON → all granted
 * so existing roles are not locked out until the matrix is saved.
 */
export function parseAccessibleModules(
  raw: unknown,
  roleCode?: string | null,
): AccessibleModules {
  if (isAdminRoleCode(roleCode)) {
    return { ...ALL_MODULES_GRANTED };
  }

  if (raw == null) {
    return { ...ALL_MODULES_GRANTED };
  }

  if (typeof raw === "string") {
    try {
      return parseAccessibleModules(JSON.parse(raw), roleCode);
    } catch {
      return { ...ALL_MODULES_GRANTED };
    }
  }

  if (!isPlainObject(raw)) {
    return { ...ALL_MODULES_GRANTED };
  }

  const next: AccessibleModules = { ...ALL_MODULES_DENIED };
  for (const key of ERP_MODULE_KEYS) {
    next[key] = raw[key] === true;
  }
  return next;
}

export function normalizeAccessibleModules(
  input: Partial<AccessibleModules> | null | undefined,
  roleCode?: string | null,
): AccessibleModules {
  if (isAdminRoleCode(roleCode)) {
    return { ...ALL_MODULES_GRANTED };
  }

  const next: AccessibleModules = { ...ALL_MODULES_DENIED };
  for (const key of ERP_MODULE_KEYS) {
    next[key] = input?.[key] === true;
  }
  return next;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/** Strip query/hash so nav hrefs like `/finance/deposits?tab=DEP_IN` match. */
export function normalizePathname(pathname: string): string {
  const raw = pathname.trim() || "/";
  const withoutHash = raw.split("#")[0] ?? raw;
  const withoutQuery = withoutHash.split("?")[0] ?? withoutHash;
  if (!withoutQuery) return "/";
  return withoutQuery.length > 1 && withoutQuery.endsWith("/")
    ? withoutQuery.slice(0, -1)
    : withoutQuery;
}

/** รับเงินมัดจำลูกค้า (DEP_IN) — Sales ใช้ได้แม้ไม่มีโมดูล finance */
export function isCustomerDepositPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return path === "/finance/deposits" || path.startsWith("/finance/deposits/");
}

export function canAccessVendorDeposits(
  modules: AccessibleModules | null | undefined,
  roleCode?: string | null,
): boolean {
  if (isAdminRoleCode(roleCode)) return true;
  return parseAccessibleModules(modules, roleCode).finance === true;
}

export function canAccessCustomerDeposits(
  modules: AccessibleModules | null | undefined,
  roleCode?: string | null,
): boolean {
  if (isAdminRoleCode(roleCode)) return true;
  const granted = parseAccessibleModules(modules, roleCode);
  return granted.sales === true || granted.finance === true;
}

export const REPORT_CENTER_PATH = "/finance/tax-reports";

/**
 * Phase 20 — บทบาทที่เปิด Report Center ได้โดยตรง
 * (admin / finance / manager ตามโจทย์ + accountant ตาม seed บัญชีภาษี)
 */
export const REPORT_CENTER_ALLOWED_ROLES = [
  "admin",
  "finance",
  "manager",
  "accountant",
] as const;

/** พนักงานหน้างาน — ห้ามเข้าถึงทะเบียนภาษี/เอกสารการเงินเด็ดขาด */
export const REPORT_CENTER_DENIED_ROLES = [
  "sales",
  "store",
  "cashier",
  "warehouse",
  "screen_printer",
  "embroiderer",
  "seamstress",
] as const;

export function isReportCenterPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  return (
    path === REPORT_CENTER_PATH || path.startsWith(`${REPORT_CENTER_PATH}/`)
  );
}

function normalizeRoleCode(roleCode: string | null | undefined): string {
  return String(roleCode ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Report Center gate — Zero Trust
 * 1) บล็อกบทบาทหน้างาน (Sales / Store / Warehouse / ช่าง) แม้ finance module = true
 * 2) อนุญาต admin / finance / manager / accountant
 * 3) บทบาทอื่นต้องมี `app_roles.accessible_modules.finance === true`
 */
export function canAccessReportCenter(
  modules: AccessibleModules | null | undefined,
  roleCode?: string | null,
): boolean {
  if (isAdminRoleCode(roleCode)) return true;

  const role = normalizeRoleCode(roleCode);
  if (!role) return false;
  if ((REPORT_CENTER_DENIED_ROLES as readonly string[]).includes(role)) {
    return false;
  }
  if ((REPORT_CENTER_ALLOWED_ROLES as readonly string[]).includes(role)) {
    return true;
  }

  return parseAccessibleModules(modules, roleCode).finance === true;
}

export function resolveModuleForPath(pathname: string): ErpModuleKey | null {
  const path = normalizePathname(pathname);
  for (const key of ERP_MODULE_KEYS) {
    if (MODULE_PATH_PREFIXES[key].some((prefix) => matchesPrefix(path, prefix))) {
      return key;
    }
  }
  return null;
}

export function isUngatedPath(pathname: string): boolean {
  const path = normalizePathname(pathname);
  if (path === "/") return true;
  return PUBLIC_OR_UNGATED_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

/**
 * Auth Guard: deny when the URL belongs to a module that is false
 * on the current role's `accessible_modules`.
 * ข้อยกเว้น: `/finance/deposits*` เปิดได้เมื่อ sales หรือ finance เป็น true
 */
export function canAccessPath(
  pathname: string,
  modules: AccessibleModules | null | undefined,
  roleCode?: string | null,
): boolean {
  const path = normalizePathname(pathname);
  if (isUngatedPath(path)) return true;
  if (isAdminRoleCode(roleCode)) return true;

  const granted = parseAccessibleModules(modules, roleCode);
  if (isReportCenterPath(path)) {
    return canAccessReportCenter(granted, roleCode);
  }
  if (isCustomerDepositPath(path) && canAccessCustomerDeposits(granted, roleCode)) {
    return true;
  }

  const moduleKey = resolveModuleForPath(path);
  if (!moduleKey) return true;

  return granted[moduleKey] === true;
}

/** Nav visibility — `requiresModule` บังคับโมดูลโดยไม่ตาม path */
export function canSeeNavItem(
  href: string,
  modules: AccessibleModules | null | undefined,
  roleCode?: string | null,
  requiresModule?: ErpModuleKey | null,
  requiresReportCenter?: boolean,
): boolean {
  if (isAdminRoleCode(roleCode)) return true;
  if (requiresReportCenter || isReportCenterPath(href)) {
    return canAccessReportCenter(modules, roleCode);
  }
  if (requiresModule) {
    return parseAccessibleModules(modules, roleCode)[requiresModule] === true;
  }
  return canAccessPath(href, modules, roleCode);
}
