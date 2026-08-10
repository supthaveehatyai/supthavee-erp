/**
 * Auth types — keep outside `"use server"` modules.
 */

import type { UserProfile } from "@/types/user";

export type SignInWithPinResult =
  | { success: true }
  | { success: false; error: string };

export type SignOutResult =
  | { success: true }
  | { success: false; error: string };

/** Profile fields loaded during PIN sign-in gate (soft-delete + optional pin check). */
export type AuthGateProfile = Pick<
  UserProfile,
  "id" | "is_active" | "full_name" | "pin_code"
>;
