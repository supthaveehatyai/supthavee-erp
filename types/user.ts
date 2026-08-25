/**
 * User Management types — kept outside `"use server"` modules.
 */

export type AppRoleOption = {
  role_code: string;
  role_name_th: string;
  description: string | null;
};

export type DataAccessScope = "ALL" | "OWN";

export const DATA_ACCESS_SCOPES: DataAccessScope[] = ["ALL", "OWN"];

export const DATA_ACCESS_SCOPE_LABELS: Record<DataAccessScope, string> = {
  ALL: "ทั้งหมด (ALL)",
  OWN: "เฉพาะของตนเอง (OWN)",
};

/** Row shape for `public.user_profiles` (RBAC + Soft Delete + PIN + ABAC). */
export type UserProfile = {
  id: string;
  email: string;
  full_name: string;
  role_code: string;
  is_active: boolean | null;
  /** 6-digit PIN snapshot on profile (nullable for legacy rows). */
  pin_code?: string | null;
  data_access_scope: DataAccessScope;
  approval_limit: number;
  created_at: string | null;
  updated_at: string | null;
};

export type ManagedUser = {
  id: string;
  email: string;
  full_name: string;
  role_code: string;
  role_name_th: string;
  is_active: boolean;
  data_access_scope: DataAccessScope;
  approval_limit: number;
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

export type UpdateUserAbacResult =
  | { success: true }
  | { success: false; error: string };

export type UpdateUserProfileResult = UpdateUserAbacResult;

export type UserAbacInput = {
  data_access_scope: DataAccessScope;
  approval_limit: number;
};

/** Update User Profile — Role + ABAC (ITGC / SoD). */
export type UpdateUserProfileInput = UserAbacInput & {
  role_code?: string;
};

/** URL-driven User Profile Form on `/settings/users` (`?profile_user_id=`). */
export const USER_PROFILE_SEARCH_PARAM = "profile_user_id";

/** @deprecated ใช้ CreateUserWithPinResult */
export type InviteUserResult = CreateUserWithPinResult;
