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

export function resolveModuleForPath(pathname: string): ErpModuleKey | null {
  const path = pathname.trim() || "/";
  for (const key of ERP_MODULE_KEYS) {
    if (MODULE_PATH_PREFIXES[key].some((prefix) => matchesPrefix(path, prefix))) {
      return key;
    }
  }
  return null;
}

export function isUngatedPath(pathname: string): boolean {
  const path = pathname.trim() || "/";
  if (path === "/") return true;
  return PUBLIC_OR_UNGATED_PREFIXES.some((prefix) => matchesPrefix(path, prefix));
}

/**
 * Auth Guard: deny when the URL belongs to a module that is false
 * on the current role's `accessible_modules`.
 */
export function canAccessPath(
  pathname: string,
  modules: AccessibleModules | null | undefined,
  roleCode?: string | null,
): boolean {
  const path = pathname.trim() || "/";
  if (isUngatedPath(path)) return true;
  if (isAdminRoleCode(roleCode)) return true;

  const moduleKey = resolveModuleForPath(path);
  if (!moduleKey) return true;

  const granted = parseAccessibleModules(modules, roleCode);
  return granted[moduleKey] === true;
}
