/**
 * Dynamic RBAC — Permission Matrix types (Phase 10).
 * Kept outside `"use server"` modules.
 */

export const ERP_MODULE_KEYS = [
  "sales",
  "purchases",
  "inventory",
  "finance",
  "settings",
] as const;

export type ErpModuleKey = (typeof ERP_MODULE_KEYS)[number];

export type AccessibleModules = Record<ErpModuleKey, boolean>;

export const ERP_MODULE_LABELS: Record<ErpModuleKey, string> = {
  sales: "ฝ่ายขาย (sales)",
  purchases: "จัดซื้อ (purchases)",
  inventory: "คลังสินค้า/ผลิต (inventory)",
  finance: "การเงิน/บัญชี (finance)",
  settings: "ตั้งค่าระบบ (settings)",
};

export type RolePermissionRow = {
  role_code: string;
  role_name_th: string;
  description: string | null;
  accessible_modules: AccessibleModules;
};

export type GetRolePermissionsResult =
  | { success: true; data: RolePermissionRow[] }
  | { success: false; error: string; data: RolePermissionRow[] };

export type UpdateRolePermissionsResult =
  | { success: true }
  | { success: false; error: string };
