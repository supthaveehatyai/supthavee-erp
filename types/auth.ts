/**
 * Auth types — keep outside `"use server"` modules.
 */

export type SignInWithPinResult =
  | { success: true }
  | { success: false; error: string };

export type SignOutResult =
  | { success: true }
  | { success: false; error: string };
