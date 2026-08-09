/**
 * User Management types — kept outside `"use server"` modules.
 */

export type AppRoleOption = {
  role_code: string;
  role_name_th: string;
  description: string | null;
};

export type ManagedUser = {
  id: string;
  email: string;
  full_name: string;
  role_code: string;
  role_name_th: string;
  is_active: boolean;
  created_at: string | null;
  updated_at: string | null;
};

export type GetUsersResult =
  | { success: true; data: ManagedUser[] }
  | { success: false; error: string; data: ManagedUser[] };

export type GetAppRolesResult =
  | { success: true; data: AppRoleOption[] }
  | { success: false; error: string; data: AppRoleOption[] };

export type CreateUserWithPinResult =
  | { success: true; userId: string }
  | { success: false; error: string };

export type DeactivateUserResult =
  | { success: true }
  | { success: false; error: string };

export type ReactivateUserResult =
  | { success: true }
  | { success: false; error: string };

/** @deprecated ใช้ CreateUserWithPinResult */
export type InviteUserResult = CreateUserWithPinResult;
