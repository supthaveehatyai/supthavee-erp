/**
 * Phase 15 — System Parameters Server Action result types.
 * Kept outside `"use server"` modules (Turbopack rule).
 */

import type { Json } from "@/src/types/supabase";

export type ParameterActionResult = {
  success: boolean;
  error?: string | null;
  message?: string | null;
  requestId?: string;
};

export type SystemParameterView = {
  param_key: string;
  param_value: Json;
  description: string | null;
  data_type: string | null;
  category: string;
};

export type PendingParameterChangeRequest = {
  id: string;
  param_key: string;
  old_value: Json | null;
  new_value: Json;
  status: string;
  requested_by: string | null;
  requested_by_name: string | null;
  created_at: string | null;
};

export type ParameterSettingsPageData = {
  parameters: SystemParameterView[];
  pendingRequests: PendingParameterChangeRequest[];
  isAdmin: boolean;
};

export type GetParameterSettingsPageDataResult =
  | { success: true; data: ParameterSettingsPageData }
  | { success: false; error: string };
